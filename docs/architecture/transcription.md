# Audio Transcription Architecture

## Overview

Audio messages received via WhatsApp webhook are transcribed using Speechmatics Batch API. The transcription happens in-process after the webhook returns 200 to Meta.

## Flow

```
1. WhatsApp sends audio message webhook
2. Webhook handler:
   - Validates signature
   - Downloads audio from WhatsApp Graph API
   - Uploads to GCS
   - Saves message to Firestore with status: pending
   - Returns 200 to WhatsApp
   - Fires transcription in background (fire-and-forget)
3. Background transcription:
   - Gets signed URL for GCS audio file
   - Submits job to Speechmatics Batch API
   - Polls until completion (with exponential backoff)
   - Fetches transcript
   - Updates message in Firestore
   - Sends transcript to user via WhatsApp (quoting original message)
```

## Architecture Decisions

### In-Process Async (vs Cloud Tasks)

We use fire-and-forget Promises for background transcription. This is simpler but has reliability implications for Cloud Run.

**Trade-offs:**

| Aspect            | In-Process Async                 | Cloud Tasks                        |
| ----------------- | -------------------------------- | ---------------------------------- |
| Reliability       | May fail if container killed     | Guaranteed delivery with retries   |
| Complexity        | Simple                           | Requires additional infrastructure |
| Cost              | No additional cost               | Cloud Tasks pricing                |
| Observability     | Same logs as webhook handler     | Separate task logs                 |
| Cold start impact | None (already warm from webhook) | May cause cold starts              |

**Mitigation strategies for in-process approach:**

- Set `min_scale=1` for whatsapp-service to reduce container termination risk
- Keep audio files short (< 5 min) for faster processing
- Monitor for orphaned pending transcriptions

**Future consideration:** If reliability issues arise, migrate to Cloud Tasks with the same handler logic.

### Domain Port Pattern

The `SpeechTranscriptionPort` interface allows swapping transcription providers:

```typescript
interface SpeechTranscriptionPort {
  submitJob(
    input: TranscriptionJobInput
  ): Promise<Result<TranscriptionJobSubmitResult, TranscriptionPortError>>;
  pollJob(jobId: string): Promise<Result<TranscriptionJobPollResult, TranscriptionPortError>>;
  getTranscript(jobId: string): Promise<Result<TranscriptionTextResult, TranscriptionPortError>>;
}
```

**To switch providers:**

1. Create new adapter in `src/infra/<provider>/`
2. Implement `SpeechTranscriptionPort`
3. Update `services.ts` to use new adapter
4. No domain or route code changes needed

### TranscriptionState Schema

Messages with audio store transcription state:

```typescript
interface TranscriptionState {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  jobId?: string; // Provider job ID
  text?: string; // Transcription result
  error?: {
    // Error details if failed
    code: string;
    message: string;
  };
  lastApiCall?: {
    // Last API call for debugging
    timestamp: string;
    operation: 'submit' | 'poll' | 'fetch_result';
    success: boolean;
    response?: unknown;
  };
  startedAt?: string;
  completedAt?: string;
}
```

## Cloud Run Risks

### Container Termination

Cloud Run may terminate containers at any time:

- After request completes (if `min_scale=0`)
- During scale-down
- During deployments

**Impact:** Transcription in progress will be lost.

**Monitoring:** Watch for messages stuck in `status: 'processing'` for extended periods.

### Recommended Configuration

For production reliability:

```terraform
module "whatsapp_service" {
  # ...
  min_scale = 1  # Keep one instance always warm
  # ...
}
```

### Recovery

Orphaned transcriptions (stuck in 'pending' or 'processing') can be recovered by:

1. Query Firestore for messages with `transcription.status` in ['pending', 'processing'] older than 1 hour
2. Re-trigger transcription via admin API (to be implemented)

## Configuration

### Environment Variables

| Variable                          | Description                            |
| --------------------------------- | -------------------------------------- |
| `INTEXURAOS_SPEECHMATICS_API_KEY` | Speechmatics Batch API key (EU region) |

### Polling Configuration

```typescript
const TRANSCRIPTION_POLL_CONFIG = {
  initialDelayMs: 2000, // Start polling after 2 seconds
  maxDelayMs: 30000, // Cap backoff at 30 seconds
  backoffMultiplier: 1.5, // Exponential backoff factor
  maxAttempts: 60, // ~5 minutes max total time
};
```

## Logging

All transcription steps are logged with structured events:

| Event                          | Description                      |
| ------------------------------ | -------------------------------- |
| `transcription_start`          | Transcription initiated          |
| `transcription_get_signed_url` | Getting signed URL for audio     |
| `transcription_submit`         | Submitting to Speechmatics       |
| `transcription_submitted`      | Job ID received                  |
| `transcription_poll`           | Polling job status               |
| `transcription_done`           | Job completed successfully       |
| `transcription_rejected`       | Job rejected by Speechmatics     |
| `transcription_timeout`        | Polling timed out                |
| `transcription_fetch`          | Fetching transcript result       |
| `transcription_completed`      | Full flow completed successfully |
| `transcription_*_error`        | Various error conditions         |

## User Notifications

Users receive WhatsApp messages (quoting the original audio):

**On success:**

```
🎙️ *Transcription:*

[transcript text]
```

**On failure:**

```
❌ *Transcription failed:*

[error details]
```
