# 2-6: Implement srt-service Polling Worker

**Tier:** 2 (Integration)

**Depends on:** 1-5, 1-6

---

## Context

srt-service needs a background worker that polls Speechmatics for non-final jobs. Uses exponential backoff (5s → 10s → 20s → ... → 1h max).

---

## Problem Statement

Implement polling worker that:

- Runs continuously (min_scale = 1)
- Finds jobs in pending/processing status
- Polls Speechmatics for status updates
- Updates local DB with results
- Uses exponential backoff per job

---

## Scope

**In scope:**

- Create PollingWorker
- Query Firestore for non-final jobs
- Poll Speechmatics for each
- Update job status in DB
- Store transcript on completion
- Exponential backoff at job level
- Track last poll time per job

**Out of scope:**

- Speechmatics webhooks
- External notification of completion

---

## Required Approach

1. Create worker with configurable poll interval
2. Query jobs where status in ['pending', 'processing']
3. For each job, check if enough time passed (backoff)
4. If yes, call Speechmatics getJobStatus
5. Update job: status, transcript (if complete), error (if failed)
6. Calculate next poll time based on backoff
7. Sleep between polling cycles

---

## Step Checklist

- [x] Create `src/workers/pollingWorker.ts`
- [x] Implement startPollingWorker()
- [x] Add lastPolledAt, pollIntervalMs fields to TranscriptionJob - SKIPPED: using nextPollAt already in model
- [x] Query non-final jobs
- [x] Calculate if poll is due (current time >= nextPollAt)
- [x] Poll Speechmatics
- [x] Update job status (pending → processing → completed/failed)
- [x] Store transcript on completion
- [x] Update pollIntervalMs with exponential backoff (5s, 10s, 20s... max 1h)
- [x] Update nextPollAt
- [x] Sleep between cycles (e.g., 1s)
- [x] Start worker in index.ts
- [x] Update TranscriptionJob model - Already had required fields
- [x] Update Firestore adapter - Already had required methods
- [x] Run npm run typecheck
- [x] Run npm run lint

---

## Definition of Done

- Worker runs continuously
- Polls pending/processing jobs
- Updates status correctly
- Exponential backoff working
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

Remove pollingWorker.ts, revert model and adapter changes.
