# 2-3: Implement Message Deletion with Async Cleanup

**Tier:** 2 (Integration)

**Depends on:** 1-0, 1-1, 1-3

---

## Context

When user deletes a message, media files in GCS must be deleted. Use async cleanup with Pub/Sub for reliability.

---

## Problem Statement

Extend DELETE /v1/whatsapp/messages/:id to:
- Delete message from Firestore immediately
- Publish cleanup event for GCS deletion
- Cleanup worker processes events with retries
- Failed events go to DLQ after 5 attempts

---

## Scope

**In scope:**
- Modify delete route to publish cleanup event
- Create cleanup worker (Pub/Sub subscriber)
- Worker deletes GCS objects (original + thumbnail)
- Idempotent deletion (ignore not found)
- Add worker startup to server.ts

**Out of scope:**
- DLQ monitoring (manual inspection)
- Transcription job cleanup

---

## Required Approach

1. Modify delete route to collect GCS paths before delete
2. Delete message from Firestore
3. Publish MediaCleanupEvent with paths
4. Create CleanupWorker that subscribes to cleanup topic
5. Worker deletes objects, acks message
6. Handle errors gracefully (no-op if not found)

---

## Step Checklist

- [ ] Modify DELETE route to extract gcsPath, thumbnailGcsPath before delete
- [ ] Delete message from Firestore first
- [ ] Publish MediaCleanupEvent with paths array
- [ ] Create `src/workers/cleanupWorker.ts`
- [ ] Implement Pub/Sub pull logic
- [ ] Delete each GCS path
- [ ] Ack message on success
- [ ] Handle not-found as success (idempotent)
- [ ] Nack on transient errors (retry)
- [ ] Start worker in server.ts
- [ ] Add integration tests
- [ ] Run npm run typecheck
- [ ] Run npm run lint
- [ ] Run npm run test

---

## Definition of Done

- Message delete triggers async cleanup
- Worker deletes GCS objects
- Idempotent behavior
- Retries via Pub/Sub semantics
- Tests pass

---

## Verification Commands

```bash
npm run typecheck
npm run lint
npm run test
```

---

## Rollback Plan

Revert delete route changes, remove cleanup worker.

