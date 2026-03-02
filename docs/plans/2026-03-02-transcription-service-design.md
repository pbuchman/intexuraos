# Transcription Service — Architecture Design

Extract transcription into a dedicated worker with provider abstraction and per-user configuration.

## Architecture

```
whatsapp-service                  Pub/Sub                    transcription (worker)
───────────────                  ─────────                   ─────────────────────
1. Receive audio via webhook
2. Download & store in GCS
3. Publish AudioStoredEvent  ──► audio-stored-{env} ──►  4. Receive event
4. Return 200 immediately                                5. Fetch user settings → provider
                                                         6. Get signed URL for GCS audio
                                                         7a. Submit job to provider
                                                         7b. Poll until done (exp. backoff)
                                                         7c. Fetch transcript result
8. Receive result            ◄── transcription-           8. Publish TranscriptionCompletedEvent
9. Update Firestore message      completed-{env} ◄──
10. Send transcript via WhatsApp
11. Publish command.ingest
                                     ▲
                                     │
                              user-service
                              GET /internal/users/:uid/settings
                              → transcriptionPreferences.provider
                              → Default: "speechmatics"
```

**Key principle:** whatsapp-service owns messaging (sending transcripts to users). The worker owns transcription (provider selection, polling, vocabulary). Clean separation of concerns.

## Provider Interface

The worker uses a strategy pattern. Each provider implements the same interface. A factory resolves the provider from the user's preference.

```typescript
interface TranscriptionProvider {
  submitJob(input: TranscriptionJobInput):
    Promise<Result<TranscriptionJobSubmitResult, TranscriptionProviderError>>

  pollJob(jobId: string):
    Promise<Result<TranscriptionJobPollResult, TranscriptionProviderError>>

  getTranscript(jobId: string):
    Promise<Result<TranscriptionTextResult, TranscriptionProviderError>>
}
```

```typescript
type ProviderName = 'speechmatics' // extend: | 'whisper' | 'deepgram'

function createProvider(name: ProviderName, config: ProviderConfig): TranscriptionProvider
```

**Adding a new provider:** Implement `TranscriptionProvider` → add case to factory → done. No changes to worker orchestration or callers.

## Event Contracts

### AudioStoredEvent → triggers worker

| Field     | Type   | Description              |
| --------- | ------ | ------------------------ |
| type      | string | `whatsapp.audio.stored`  |
| userId    | string | IntexuraOS user ID       |
| messageId | string | WhatsApp message ID      |
| mediaId   | string | WhatsApp media ID        |
| gcsPath   | string | GCS path to audio file   |
| mimeType  | string | Audio MIME type          |
| timestamp | string | ISO 8601                 |

**Publisher:** whatsapp-service → **Topic:** `audio-stored-{env}` → **Subscriber:** transcription worker

### TranscriptionCompletedEvent → returns result

| Field             | Type   | Description                       |
| ----------------- | ------ | --------------------------------- |
| type              | string | `srt.transcription.completed`     |
| userId            | string | IntexuraOS user ID                |
| messageId         | string | WhatsApp message ID               |
| jobId             | string | Provider-specific job ID          |
| status            | string | `completed` or `failed`           |
| transcript?       | string | Transcribed text (when completed) |
| summary?          | string | AI-generated summary (NEW)        |
| detectedLanguage? | string | Language code e.g. `pl` (NEW)     |
| error?            | string | Error message (when failed)       |
| timestamp         | string | ISO 8601                          |

**Publisher:** transcription worker → **Topic:** `transcription-completed-{env}` → **Subscriber:** whatsapp-service

**Deleted:** `TranscribeAudioEvent` (`whatsapp.audio.transcribe`) — removed entirely. No backward compatibility.

## Worker Structure

```
workers/transcription/src/
├── index.ts                          # Cloud Functions entry point
├── main.ts                           # Business logic orchestration
├── logger.ts                         # Pino logger
├── types.ts                          # Event types, provider config
├── providers/
│   ├── transcription-provider.ts     # Interface (port)
│   ├── provider-factory.ts           # Resolves provider by name
│   └── speechmatics/
│       ├── adapter.ts                # Moved from whatsapp-service
│       └── vocabulary.ts             # ADDITIONAL_VOCAB extracted
├── polling.ts                        # pollUntilComplete (moved from use case)
├── format-error.ts                   # formatSpeechmaticsError (moved)
└── __tests__/
    ├── main.test.ts
    ├── polling.test.ts
    └── providers/
        ├── provider-factory.test.ts
        └── speechmatics-adapter.test.ts
```

## Whatsapp-Service Changes

| File / Module                        | Change | Details                                                                    |
| ------------------------------------ | ------ | -------------------------------------------------------------------------- |
| `infra/speechmatics/`                | DELETE | Entire directory — adapter moves to worker                                 |
| `domain/usecases/transcribeAudio.ts` | DELETE | Orchestration moves to worker's main.ts                                    |
| `domain/ports/transcription.ts`      | DELETE | Port moves to worker's providers/                                          |
| `domain/formatSpeechmaticsError.ts`  | DELETE | Moves to worker's format-error.ts                                          |
| `routes/pubsubRoutes.ts`             | MODIFY | Remove `/transcribe-audio` handler. Add `/transcription-completed` handler |
| `routes/webhookRoutes.ts`            | MODIFY | Publish `AudioStoredEvent` instead of `TranscribeAudioEvent`               |
| `services.ts`                        | MODIFY | Remove `transcriptionService`. Add `audioStoredPublisher`                  |
| `config.ts`                          | MODIFY | Remove `speechmaticsApiKey`. Add topic config                              |
| `package.json`                       | MODIFY | Remove `@speechmatics/batch-client` dependency                             |
| `domain/events/events.ts`            | MODIFY | Delete `TranscribeAudioEvent`. Expand `TranscriptionCompletedEvent`        |

**What stays in whatsapp-service:** Receiving the completed event, updating Firestore message state, sending transcript via WhatsApp (language-specific formatting), publishing `command.ingest` event.

## User-Service Settings

Following the `llmPreferences.defaultModel` pattern:

```typescript
interface TranscriptionPreferences {
  provider: 'speechmatics' // extend: | 'whisper' | 'deepgram'
}

interface UserSettings {
  // ... existing fields ...
  transcriptionPreferences?: TranscriptionPreferences
}
```

| File                                              | Change                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `domain/settings/models/UserSettings.ts`          | Add `TranscriptionPreferences` interface + optional field                 |
| `domain/settings/ports/UserSettingsRepository.ts` | Add `updateTranscriptionPreferences` method                               |
| `infra/firestore/userSettingsRepository.ts`       | Implement update method (same pattern as LLM preferences)                 |
| `routes/internalRoutes.ts`                        | Include `transcriptionPreferences` in GET `/internal/users/:uid/settings` |
| `routes/settingsRoutes.ts`                        | Add PATCH for transcription provider                                      |

**Default behavior:** When `transcriptionPreferences` is undefined, the worker defaults to `'speechmatics'`. No migration needed for existing users.

## Infrastructure (Terraform)

| Resource                                  | Change | Details                                                   |
| ----------------------------------------- | ------ | --------------------------------------------------------- |
| Cloud Function: transcription             | NEW    | Worker entry point, triggered by Pub/Sub                  |
| pubsub: `audio-stored-{env}`              | NEW    | Topic for AudioStoredEvent, subscription pushes to worker |
| pubsub: `transcription-completed-{env}`   | NEW    | Topic for result, subscription pushes to whatsapp-service |
| `SPEECHMATICS_APP_API_KEY`                | MOVE   | From whatsapp-service → transcription worker              |
| pubsub: `whatsapp-transcription-{env}`    | DELETE | Old TranscribeAudioEvent topic + subscription             |

### Worker Environment Variables

| Variable                                          | Purpose                  |
| ------------------------------------------------- | ------------------------ |
| `INTEXURAOS_SPEECHMATICS_APP_API_KEY`             | Provider API key         |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`                  | For user-service calls   |
| `INTEXURAOS_USER_SERVICE_URL`                     | To fetch user settings   |
| `INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC` | Publish results          |
| `INTEXURAOS_GCP_PROJECT_ID`                       | GCS signed URLs          |
| `INTEXURAOS_WHATSAPP_MEDIA_BUCKET`                | GCS bucket for audio     |

## Migration Plan

One-time cutover, no backward compatibility. Any in-flight transcriptions on the old topic will be lost (user can re-send audio).

1. **Deploy transcription worker** — New Cloud Function + new Pub/Sub topics + subscriptions. Worker is running but no events flowing yet.
2. **Deploy user-service changes** — Add `transcriptionPreferences` to settings model. Exposed via internal API. Existing users get default (speechmatics).
3. **Deploy whatsapp-service changes** — Publishes `AudioStoredEvent`, subscribes to `TranscriptionCompletedEvent`. All old transcription code removed. This is the cutover moment.
4. **Delete old infrastructure** — Remove `pubsub_whatsapp_transcription` topic + subscription from Terraform. Remove Speechmatics secret from whatsapp-service.

## Unchanged

| Component                                                                | Status    |
| ------------------------------------------------------------------------ | --------- |
| GCS audio storage (whatsapp-media bucket)                                | UNCHANGED |
| WhatsApp message formatting (emoji, language detection, summary phrases) | UNCHANGED |
| Firestore `whatsapp_messages` collection + `TranscriptionState` schema   | UNCHANGED |
| `command.ingest` event publishing to commands-agent                      | UNCHANGED |
| Polling config (2s initial, 30s max, 1.5x backoff, 60 attempts)          | UNCHANGED |
| Speechmatics API config (EU region, enhanced mode, summarization)        | UNCHANGED |
