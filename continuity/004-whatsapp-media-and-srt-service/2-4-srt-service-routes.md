# 2-4: Implement srt-service Routes

**Tier:** 2 (Integration)

**Depends on:** 1-5, 1-6

---

## Context

srt-service needs HTTP routes for:

1. Internal endpoint to create transcription job (called by worker)
2. Status endpoint for other services to query job state

---

## Problem Statement

Implement Fastify routes:

- POST /v1/transcribe — create job (internal use by worker)
- GET /v1/transcribe/:jobId — get job status by srtJobId

---

## Scope

**In scope:**

- POST /v1/transcribe with { messageId, mediaId, gcsPath }
- Idempotency check before creating job
- Call Speechmatics API to create job
- Store job with pending status
- GET /v1/transcribe/:jobId returns status from DB
- Service-to-service auth validation
- OpenAPI schema

**Out of scope:**

- Background polling (separate task)
- Web UI for transcripts

---

## Required Approach

1. Create transcribeRoutes.ts
2. POST validates caller identity (Google ID token)
3. Check idempotency by (messageId, mediaId)
4. If exists, return existing jobId
5. Create Speechmatics job
6. Store in Firestore
7. Return { jobId, status: 'pending' }
8. GET reads from DB only

---

## Step Checklist

- [ ] Create `src/routes/v1/transcribeRoutes.ts`
- [ ] Add POST /v1/transcribe route
- [ ] Validate service-to-service auth (Google ID token)
- [ ] Extract and validate caller identity
- [ ] Check findByMediaKey for existing job
- [ ] If exists, return existing jobId (idempotent)
- [ ] Generate new srtJobId (UUID)
- [ ] Call Speechmatics createJob
- [ ] Store TranscriptionJob with pending status
- [ ] Return { jobId, status }
- [ ] Add GET /v1/transcribe/:jobId route
- [ ] Fetch job from repository
- [ ] Return { jobId, status, transcript?, error? }
- [ ] Add OpenAPI schemas
- [ ] Wire routes in server.ts
- [ ] Add integration tests
- [ ] Run npm run typecheck
- [ ] Run npm run lint
- [ ] Run npm run test

---

## Definition of Done

- Both routes implemented
- Idempotency enforced
- Auth validated
- OpenAPI documented
- Tests pass

---

## Verification Commands

```bash
cd apps/srt-service
npm run typecheck
npm run lint
npm run test
```

---

## Rollback Plan

Remove transcribeRoutes.ts, revert server.ts.
