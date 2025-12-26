# 1-5: Implement srt-service Domain Layer

**Tier:** 1 (Independent Deliverable)

---

## Context

srt-service needs a domain layer for transcription jobs:

- Own job IDs (not Speechmatics IDs)
- Job state machine (pending → processing → completed/failed)
- Strong idempotency by (messageId, mediaId)

---

## Problem Statement

Define the domain model and ports for transcription jobs:

- TranscriptionJob model with internal ID
- Job repository port
- Speechmatics client port
- Idempotency check by composite key

---

## Scope

**In scope:**

- Define TranscriptionJob model
- Define TranscriptionJobStatus enum
- Define TranscriptionJobRepository port
- Define SpeechmaticsClient port
- Define error types

**Out of scope:**

- Infrastructure implementations (later tasks)
- Polling worker logic

---

## Required Approach

1. Create domain/transcription/ directory
2. Define TranscriptionJob with fields:
   - id (internal srtJobId)
   - messageId, mediaId (composite key for idempotency)
   - speechmaticsJobId (external reference)
   - status, transcript, error
   - timestamps
3. Define repository port for CRUD + findByMediaKey
4. Define Speechmatics client port

---

## Step Checklist

- [ ] Create `src/domain/transcription/models/TranscriptionJob.ts`
- [ ] Define TranscriptionJobStatus = 'pending' | 'processing' | 'completed' | 'failed'
- [ ] Define TranscriptionJob interface with all fields
- [ ] Create `src/domain/transcription/ports/repositories.ts`
- [ ] Define TranscriptionJobRepository interface
- [ ] Add findByMediaKey(messageId, mediaId) method for idempotency
- [ ] Create `src/domain/transcription/ports/speechmaticsClient.ts`
- [ ] Define SpeechmaticsClient interface (createJob, getJobStatus)
- [ ] Define SpeechmaticsJobResponse types
- [ ] Create `src/domain/transcription/index.ts` exports
- [ ] Run npm run typecheck
- [ ] Run npm run lint

---

## Definition of Done

- Domain models fully defined
- Repository port with idempotency method
- Speechmatics client port defined
- All types exported
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

Delete domain/transcription/ directory.
