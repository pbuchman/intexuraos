# 1-6: Implement srt-service Infrastructure Layer

**Tier:** 1 (Independent Deliverable)

---

## Context

srt-service needs infrastructure implementations:

- Firestore adapter for job repository
- Speechmatics Batch API client
- Pub/Sub subscriber for audio.stored events

---

## Problem Statement

Implement adapters for the ports defined in domain layer:

- TranscriptionJobRepository → Firestore
- SpeechmaticsClient → Speechmatics Batch API
- AudioStoredSubscriber → Pub/Sub pull

---

## Scope

**In scope:**

- Firestore repository with idempotency check
- Speechmatics client with API key auth
- Pub/Sub pull subscriber skeleton
- Service container (services.ts)
- Config for API key, subscription name

**Out of scope:**

- Background polling worker (later task)
- Route handlers

---

## Required Approach

1. Create Firestore adapter for jobs collection
2. Implement idempotency: check existing before create
3. Create Speechmatics client using fetch
4. Create Pub/Sub subscriber that pulls messages
5. Wire all in services.ts

---

## Step Checklist

- [ ] Create `src/infra/firestore/jobRepository.ts`
- [ ] Implement TranscriptionJobRepository
- [ ] Add findByMediaKey with Firestore query
- [ ] Create `src/infra/speechmatics/client.ts`
- [ ] Implement createJob (POST /v2/jobs)
- [ ] Implement getJobStatus (GET /v2/jobs/{id})
- [ ] Add API key auth header
- [ ] Create `src/infra/pubsub/subscriber.ts`
- [ ] Implement pull subscription logic
- [ ] Create `src/services.ts` with DI container
- [ ] Update `src/config.ts` with Speechmatics + Pub/Sub config
- [ ] Create fakes for testing
- [ ] Run npm run typecheck
- [ ] Run npm run lint

---

## Definition of Done

- All adapters implemented
- Firestore queries working
- Speechmatics API calls structured
- Pub/Sub pull logic in place
- Service container wired
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

Delete infra/ directory contents, revert services.ts and config.ts.
