# Transcription Worker -- Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                            |
| --------- | ---------------------------------------------------------------- |
| Name      | transcription                                                    |
| Type      | Cloud Function (worker)                                          |
| Role      | Convert audio files to text via Speechmatics                     |
| Goal      | Produce a TranscriptionCompletedEvent for every AudioStoredEvent |

## Capabilities

### Transcribe Audio

**Trigger:** Pub/Sub CloudEvent on `audio-stored` topic

**When to use:** Automatically triggered when whatsapp-service stores audio in GCS. No manual invocation.

**Input Schema:**

```typescript
interface AudioStoredEvent {
  type: 'whatsapp.audio.stored';
  userId: string;
  messageId: string;
  mediaId: string;
  gcsPath: string;
  mimeType: string;
  timestamp: string; // ISO 8601
}
```

**Output Schema:**

```typescript
interface TranscriptionCompletedEvent {
  type: 'srt.transcription.completed';
  userId: string;
  messageId: string;
  jobId: string;
  status: 'completed' | 'failed';
  transcript?: string;
  summary?: string;
  detectedLanguage?: string;
  error?: string;
  timestamp: string; // ISO 8601
}
```

**Output Topic:** `transcription-completed` (Pub/Sub)

**Example:**

```json
// Input (AudioStoredEvent)
{
  "type": "whatsapp.audio.stored",
  "userId": "user-abc-123",
  "messageId": "wamid.xyz789",
  "mediaId": "media-456",
  "gcsPath": "audio/user-abc-123/wamid.xyz789.ogg",
  "mimeType": "audio/ogg",
  "timestamp": "2026-03-07T10:00:00Z"
}

// Output (TranscriptionCompletedEvent) - success
{
  "type": "srt.transcription.completed",
  "userId": "user-abc-123",
  "messageId": "wamid.xyz789",
  "jobId": "sm-job-12345",
  "status": "completed",
  "transcript": "I need to check the Sentry alerts for the calendar-agent",
  "summary": "User wants to review calendar-agent alerts in Sentry.",
  "detectedLanguage": "en",
  "timestamp": "2026-03-07T10:01:30Z"
}

// Output (TranscriptionCompletedEvent) - failure
{
  "type": "srt.transcription.completed",
  "userId": "user-abc-123",
  "messageId": "wamid.xyz789",
  "jobId": "unknown",
  "status": "failed",
  "error": "Audio file is too short for transcription",
  "timestamp": "2026-03-07T10:00:05Z"
}
```

## Constraints

**Do NOT:**

- Call this worker directly -- it is triggered only via Pub/Sub
- Expect real-time responses -- processing takes seconds to minutes
- Assume transcript will always be present -- check `status` field first
- Rely on `mediaId` for file identification -- use `gcsPath`

**Requires:**

- Audio file must be stored in GCS before the event is published
- `INTEXURAOS_SPEECHMATICS_APP_API_KEY` must be configured
- user-service must be accessible (falls back to Speechmatics on failure)

## Usage Patterns

### Pattern 1: Standard Transcription Flow

```
1. whatsapp-service stores audio in GCS
2. whatsapp-service publishes AudioStoredEvent to audio-stored topic
3. Worker processes and publishes TranscriptionCompletedEvent
4. whatsapp-service consumes completed event and updates message state
```

### Pattern 2: Error Handling

```
1. Any failure at any step produces a TranscriptionCompletedEvent with status: 'failed'
2. Consumer checks event.status
3. If 'failed', event.error contains a user-friendly message
4. Consumer can display error or retry by re-publishing AudioStoredEvent
```

## Error Handling

| Error Scenario                | jobId Value  | error Field                       |
| ----------------------------- | ------------ | --------------------------------- |
| Signed URL generation failure | `unknown`    | Storage error message             |
| Job submission failure        | `unknown`    | Formatted Speechmatics error      |
| Poll timeout                  | Actual jobId | "Transcription polling timed out" |
| Job rejected                  | Actual jobId | Formatted rejection reason        |
| Transcript fetch failure      | Actual jobId | Formatted Speechmatics error      |
| Unexpected exception          | `unknown`    | Exception message                 |

## Dependencies

| Service      | Why Needed                        | Failure Behavior        |
| ------------ | --------------------------------- | ----------------------- |
| Speechmatics | Audio transcription               | Publish failed event    |
| GCS          | Audio file access via signed URLs | Publish failed event    |
| user-service | Provider preference lookup        | Default to speechmatics |
| Pub/Sub      | Event publishing                  | Log error (event lost)  |

## Outgoing HTTP Calls

| Target       | Method | Path                               | Auth              |
| ------------ | ------ | ---------------------------------- | ----------------- |
| user-service | GET    | `/internal/users/:userId/settings` | `X-Internal-Auth` |
| Speechmatics | POST   | Batch API (via SDK)                | API key           |

## Environment Variables

| Variable                                          | Required |
| ------------------------------------------------- | -------- |
| `INTEXURAOS_SPEECHMATICS_APP_API_KEY`             | Yes      |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`                  | Yes      |
| `INTEXURAOS_USER_SERVICE_URL`                     | Yes      |
| `INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC` | Yes      |
| `INTEXURAOS_GCP_PROJECT_ID`                       | Yes      |
| `INTEXURAOS_WHATSAPP_MEDIA_BUCKET`                | Yes      |
