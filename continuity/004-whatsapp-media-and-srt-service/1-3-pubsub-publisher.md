# 1-3: Add Pub/Sub Publisher to whatsapp-service

**Tier:** 1 (Independent Deliverable)

---

## Context

whatsapp-service needs to publish events to Pub/Sub:
1. `whatsapp.audio.stored` — when audio is stored, triggers srt-service
2. `whatsapp.media.cleanup` — when message deleted, triggers async cleanup

---

## Problem Statement

Create a Pub/Sub publisher port and adapter for whatsapp-service:
- Publish structured events with message context
- Handle publish errors gracefully
- Support different event types

---

## Scope

**In scope:**
- Define event types/schemas
- Create PubSubPublisherPort interface
- Implement GcpPubSubPublisher adapter
- Add @google-cloud/pubsub dependency
- Add to service container
- Create fake for testing
- Read topic names from config

**Out of scope:**
- Subscriber logic (srt-service task)
- Cleanup worker (later task)
- Integration with webhook

---

## Required Approach

1. Define event schemas for audio.stored and media.cleanup
2. Create publisher port interface
3. Implement with @google-cloud/pubsub
4. Add topic names to config.ts
5. Add to service container
6. Create fake for tests

---

## Step Checklist

- [ ] Add @google-cloud/pubsub to package.json
- [ ] Create `src/domain/inbox/events/` directory
- [ ] Define AudioStoredEvent interface
- [ ] Define MediaCleanupEvent interface
- [ ] Create `src/domain/inbox/ports/eventPublisher.ts`
- [ ] Define EventPublisherPort interface
- [ ] Create `src/infra/pubsub/publisher.ts`
- [ ] Implement GcpPubSubPublisher
- [ ] Update config.ts with topic name env vars
- [ ] Add to services.ts container
- [ ] Create FakeEventPublisher in __tests__/fakes.ts
- [ ] Export from domain index
- [ ] Run npm install
- [ ] Run npm run typecheck
- [ ] Run npm run lint

---

## Definition of Done

- Event types defined
- Publisher port and adapter implemented
- Topic names configurable via env vars
- Fake available for testing
- Typecheck passes

---

## Verification Commands

```bash
cd apps/whatsapp-service
npm install
npm run typecheck
npm run lint
```

---

## Rollback Plan

Remove @google-cloud/pubsub, delete event types and publisher files.

