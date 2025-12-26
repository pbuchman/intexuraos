# 4-1: Test Coverage for srt-service

**Tier:** 4 (Verification)

**Depends on:** 2-4, 2-5, 2-6

---

## Context

srt-service must have test coverage meeting project thresholds.

---

## Problem Statement

Ensure test coverage for:
- TranscriptionJob model
- Firestore repository (via fakes)
- Speechmatics client (mocked)
- Transcribe routes
- Audio event worker
- Polling worker

---

## Scope

**In scope:**
- Unit tests for domain models
- Integration tests for routes (using fakes)
- Fakes for repository, Speechmatics
- Coverage verification

**Out of scope:**
- E2E tests against real Speechmatics
- Real Pub/Sub integration

---

## Required Approach

1. Create fakes for all adapters
2. Add unit tests for use cases
3. Add integration tests for routes
4. Mock Speechmatics responses
5. Test idempotency logic
6. Verify coverage thresholds

---

## Step Checklist

- [ ] Create FakeTranscriptionJobRepository
- [ ] Create FakeSpeechmaticsClient
- [ ] Create FakeSubscriber for testing
- [ ] Add unit tests for idempotency logic
- [ ] Add integration tests for POST /v1/transcribe
- [ ] Add integration tests for GET /v1/transcribe/:jobId
- [ ] Test duplicate request returns existing job
- [ ] Test Speechmatics error handling
- [ ] Run npm run test:coverage
- [ ] Verify thresholds met

---

## Definition of Done

- All new code has tests
- Coverage thresholds met
- CI passes

---

## Verification Commands

```bash
cd apps/srt-service
npm run test:coverage
npm run ci
```

---

## Rollback Plan

N/A - tests only.

