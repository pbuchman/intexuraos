# 2-5: Implement srt-service Audio Event Worker

**Tier:** 2 (Integration)

**Depends on:** 1-5, 1-6, 2-4

---

## Context

srt-service subscribes to `whatsapp.audio.stored` events via Pub/Sub pull subscription. Worker processes events and creates transcription jobs.

---

## Problem Statement

Implement Pub/Sub pull worker that:

- Pulls messages from subscription
- Extracts event data (userId, messageId, mediaId, gcsPath)
- Calls internal transcribe route/use case
- Acks message on success
- Nacks on transient failure for retry

---

## Scope

**In scope:**

- Create AudioEventWorker
- Pull from subscription
- Process each message
- Use transcription use case directly (not HTTP)
- Ack/Nack based on result
- Start worker in server.ts (continuous)

**Out of scope:**

- Polling worker (separate task)
- HTTP route for external trigger

---

## Required Approach

1. Create worker that starts on server boot
2. Use @google-cloud/pubsub subscriber
3. Pull messages in loop
4. Parse AudioStoredEvent from message
5. Call CreateTranscriptionJobUseCase
6. Ack on success, Nack on transient error
7. Handle permanent errors by acking (avoid infinite loop)

---

## Step Checklist

- [x] Create `src/workers/audioEventWorker.ts`
- [x] Implement startAudioEventWorker()
- [x] Get subscription from config
- [x] Pull messages continuously
- [x] Parse AudioStoredEvent JSON
- [x] Validate required fields
- [x] Call CreateTranscriptionJobUseCase (via repository directly)
- [x] Ack message on success
- [x] Ack message on idempotent duplicate (already exists)
- [x] Nack on transient Speechmatics error
- [x] Ack on permanent error (log and continue)
- [x] Start worker in index.ts
- [x] Add config for subscription name
- [x] Run npm run typecheck
- [x] Run npm run lint

---

## Definition of Done

- Worker starts on boot
- Processes audio.stored events
- Creates transcription jobs
- Proper ack/nack handling
- Typecheck passes

---

## Verification Commands

```bash
cd apps/srt-service
npm run typecheck
npm run lint
```

---

## Rollback Plan

Remove audioEventWorker.ts, revert server.ts.
