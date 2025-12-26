# 1-4: Delete Transcription Worker

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

`apps/whatsapp-service/src/workers/transcriptionWorker.ts` is a Pub/Sub subscriber that listens for transcription completed events. No longer needed since transcription will be in-process.

## Problem Statement

Delete the transcription Pub/Sub worker from whatsapp-service.

## Scope

**In scope:**
- Delete `apps/whatsapp-service/src/workers/transcriptionWorker.ts`
- Update `apps/whatsapp-service/src/workers/index.ts` if it exports this worker

**Out of scope:**
- Pub/Sub terraform (1-5)
- Config changes for subscription name (2-2)

## Required Approach

1. Delete transcriptionWorker.ts
2. Update workers/index.ts to remove export
3. Note: Keep cleanupWorker.ts (media cleanup still uses Pub/Sub)

## Step Checklist

- [ ] Delete `apps/whatsapp-service/src/workers/transcriptionWorker.ts`
- [ ] Update `apps/whatsapp-service/src/workers/index.ts` to remove transcription worker export
- [ ] Verify cleanupWorker.ts is preserved

## Definition of Done

- transcriptionWorker.ts deleted
- workers/index.ts updated
- cleanupWorker.ts preserved

## Verification Commands

```bash
ls apps/whatsapp-service/src/workers/transcriptionWorker.ts 2>&1 | grep "No such file"
ls apps/whatsapp-service/src/workers/cleanupWorker.ts && echo "Cleanup worker preserved - OK"
cat apps/whatsapp-service/src/workers/index.ts
```

## Rollback Plan

```bash
git checkout -- apps/whatsapp-service/src/workers/
```

