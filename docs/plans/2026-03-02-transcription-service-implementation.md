# Transcription Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract transcription capabilities into a dedicated worker service with provider abstraction and per-user configuration.

**Architecture:** Event-driven microservice architecture. Whatsapp-service publishes `AudioStoredEvent` when audio is received. Transcription worker consumes events, fetches user provider preference from user-service, performs transcription via the selected provider, and publishes `TranscriptionCompletedEvent` back to whatsapp-service.

**Tech Stack:** Node.js 20, Cloud Functions Framework, Pub/Sub, Firestore, Speechmatics Batch API, TypeScript, Vitest

**Linear Issue:** [INT-681](https://linear.app/pbuchman/issue/INT-681)

**Design Document:** [docs/plans/2026-03-02-transcription-service-design.md](./2026-03-02-transcription-service-design.md)

---

## Parallel Work Breakdown

This implementation is split into 4 independent subtasks that can be executed in parallel by separate agents. Each subtask has clearly defined contracts ensuring no inter-task dependencies during development.

### Subtask Dependencies Graph

```
             ┌──────────────────┐
             │     INT-681      │
             │ (Parent Issue)   │
             └────────┬─────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
    ▼                 ▼                 ▼
┌───────┐       ┌───────┐       ┌───────┐       ┌───────┐
│INT-682│       │INT-683│       │INT-684│       │INT-685│
│Worker │       │User   │       │WA Svc │       │Infra  │
└───────┘       └───────┘       └───────┘       └───────┘
    │                 │                 │               │
    │    Contracts    │                 │               │
    ├─────────────────┤                 │               │
    │ AudioStoredEvent│◄────────────────┤               │
    │ TranscriptionCompletedEvent────────►              │
    │ GET /internal/users/:uid/settings │               │
    └─────────────────┴─────────────────┴───────────────┘

All subtasks can be developed in parallel using mocked contracts.
Deployment order: Worker → User-Service → Whatsapp-Service → Delete old infra
```

---

## Subtask 1: Create Transcription Worker (INT-682)

### Contract

**Input Event:** `AudioStoredEvent` from `audio-stored-{env}` topic
```typescript
interface AudioStoredEvent {
  type: 'whatsapp.audio.stored'
  userId: string
  messageId: string
  mediaId: string
  gcsPath: string
  mimeType: string
  timestamp: string
}
```

**Output Event:** `TranscriptionCompletedEvent` to `transcription-completed-{env}` topic
```typescript
interface TranscriptionCompletedEvent {
  type: 'srt.transcription.completed'
  userId: string
  messageId: string
  jobId: string
  status: 'completed' | 'failed'
  transcript?: string
  summary?: string
  detectedLanguage?: string
  error?: string
  timestamp: string
}
```

**External Call:** `GET /internal/users/:uid/settings` → `transcriptionPreferences.provider`

### Files

- Create: `workers/transcription/package.json`
- Create: `workers/transcription/tsconfig.json`
- Create: `workers/transcription/vitest.config.ts`
- Create: `workers/transcription/src/index.ts`
- Create: `workers/transcription/src/main.ts`
- Create: `workers/transcription/src/logger.ts`
- Create: `workers/transcription/src/types.ts`
- Create: `workers/transcription/src/providers/transcription-provider.ts`
- Create: `workers/transcription/src/providers/provider-factory.ts`
- Create: `workers/transcription/src/providers/speechmatics/adapter.ts`
- Create: `workers/transcription/src/providers/speechmatics/vocabulary.ts`
- Create: `workers/transcription/src/polling.ts`
- Create: `workers/transcription/src/format-error.ts`
- Test: `workers/transcription/src/__tests__/*.test.ts`

### Steps

1. Use `/create-service` command to scaffold worker
2. Move `SpeechTranscriptionPort` interface from whatsapp-service
3. Move `SpeechmaticsTranscriptionAdapter` from whatsapp-service
4. Extract `ADDITIONAL_VOCAB` into separate vocabulary.ts
5. Move `formatSpeechmaticsError` from whatsapp-service
6. Extract polling logic from `TranscribeAudioUseCase`
7. Implement provider factory
8. Implement main.ts orchestration
9. Write tests with mocked dependencies
10. Verify 95%+ coverage

---

## Subtask 2: User-Service Changes (INT-683)

### Contract

**Provides:** `transcriptionPreferences` in GET `/internal/users/:uid/settings`
**Default:** `'speechmatics'` when undefined

```typescript
interface TranscriptionPreferences {
  provider: 'speechmatics'
}
```

### Files

- Modify: `apps/user-service/src/domain/settings/models/UserSettings.ts`
- Modify: `apps/user-service/src/domain/settings/ports/UserSettingsRepository.ts`
- Modify: `apps/user-service/src/infra/firestore/userSettingsRepository.ts`
- Modify: `apps/user-service/src/routes/internalRoutes.ts`
- Modify: `apps/user-service/src/routes/settingsRoutes.ts`
- Test: `apps/user-service/src/__tests__/routes/*.test.ts`

### Steps

1. Add `TranscriptionPreferences` interface to UserSettings.ts
2. Add optional `transcriptionPreferences` field to `UserSettings`
3. Add `updateTranscriptionPreferences` to repository port
4. Implement repository method (follow llmPreferences pattern)
5. Update internal routes to include preferences in response
6. Add PATCH route for transcription provider
7. Write tests
8. Verify 95%+ coverage

---

## Subtask 3: Whatsapp-Service Changes (INT-684)

### Contract

**Publishes:** `AudioStoredEvent` to `audio-stored-{env}`
**Subscribes:** `TranscriptionCompletedEvent` from `transcription-completed-{env}`

### Files

- Delete: `apps/whatsapp-service/src/infra/speechmatics/`
- Delete: `apps/whatsapp-service/src/domain/whatsapp/usecases/transcribeAudio.ts`
- Delete: `apps/whatsapp-service/src/domain/whatsapp/ports/transcription.ts`
- Delete: `apps/whatsapp-service/src/domain/whatsapp/formatSpeechmaticsError.ts`
- Modify: `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- Modify: `apps/whatsapp-service/src/routes/webhookRoutes.ts`
- Modify: `apps/whatsapp-service/src/services.ts`
- Modify: `apps/whatsapp-service/src/config.ts`
- Modify: `apps/whatsapp-service/package.json`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/events/events.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/index.ts`
- Test: `apps/whatsapp-service/src/__tests__/*.test.ts`

### Steps

1. Add AudioStoredPublisher to services.ts
2. Update webhookRoutes to publish AudioStoredEvent (instead of TranscribeAudioEvent)
3. Add `/transcription-completed` handler in pubsubRoutes
4. Implement handler: update Firestore, send WhatsApp message, publish command.ingest
5. Keep language-specific formatting (getSummaryIntroPhrase, stripMarkdownHeaders)
6. Delete old transcription files
7. Remove `transcriptionService` from services.ts
8. Remove `speechmaticsApiKey` from config
9. Delete `TranscribeAudioEvent` from events.ts
10. Update barrel exports
11. Remove `@speechmatics/batch-client` from package.json
12. Update tests
13. Verify 95%+ coverage

---

## Subtask 4: Infrastructure Changes (INT-685)

### Contract

**Creates:**
- `transcription` Cloud Function
- `audio-stored-{env}` Pub/Sub topic + subscription
- `transcription-completed-{env}` Pub/Sub topic + subscription

**Moves:** `SPEECHMATICS_APP_API_KEY` from whatsapp-service to transcription worker

**Deletes:**
- `whatsapp-transcription-{env}` topic + subscription

### Files

- Modify: `terraform/modules/pubsub/main.tf`
- Modify: `terraform/modules/pubsub/variables.tf`
- Modify: `terraform/modules/pubsub/outputs.tf`
- Modify: `terraform/modules/cloud-functions/main.tf`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `terraform/environments/prod/main.tf`

### Steps

1. Add `audio-stored` topic resource
2. Add `audio-stored` subscription (push to transcription worker)
3. Add `transcription-completed` topic resource
4. Add `transcription-completed` subscription (push to whatsapp-service)
5. Add transcription Cloud Function resource
6. Configure worker env vars and secrets
7. Remove speechmatics secret from whatsapp-service
8. Add audio-stored topic env var to whatsapp-service
9. Remove old whatsapp-transcription topic and subscription
10. Run `terraform fmt -check -recursive`
11. Run `terraform validate`

---

## Deployment Order

1. **Deploy transcription worker** — Function running but no events yet
2. **Deploy user-service** — Preferences available via API
3. **Deploy whatsapp-service** — Starts publishing/consuming new events (cutover)
4. **Delete old infrastructure** — Clean up old Pub/Sub resources

---

## Verification Checklist

- [ ] All 4 subtasks pass `pnpm run ci:tracked`
- [ ] Terraform validates successfully
- [ ] Integration test: Send audio via WhatsApp → Receive transcription
- [ ] Verify user settings API includes transcriptionPreferences
- [ ] Verify worker respects user provider preference
