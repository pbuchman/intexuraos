# 4-0: Test Coverage for whatsapp-service Media

**Tier:** 4 (Verification)

**Depends on:** 2-0, 2-1, 2-2, 2-3

---

## Context

All new whatsapp-service media functionality must have test coverage meeting project thresholds.

---

## Problem Statement

Ensure test coverage for:
- Message model extensions
- GCS adapter (via fakes)
- Thumbnail generator
- Pub/Sub publisher (via fakes)
- WhatsApp media client
- Webhook processing for image/audio
- Media routes
- Cleanup worker

---

## Scope

**In scope:**
- Unit tests for utility functions
- Integration tests for routes (using fakes)
- Fakes for GCS, Pub/Sub
- Coverage verification

**Out of scope:**
- E2E tests against real services
- srt-service tests (separate task)

---

## Required Approach

1. Review existing test patterns
2. Create fakes for new adapters
3. Add unit tests for thumbnail generator
4. Add integration tests for media routes
5. Add integration tests for webhook with media
6. Verify coverage thresholds

---

## Step Checklist

- [ ] Create FakeMediaStorageRepository
- [ ] Create FakeEventPublisher
- [ ] Add unit tests for thumbnailGenerator
- [ ] Add integration tests for GET /messages/:id/media
- [ ] Add integration tests for GET /messages/:id/thumbnail
- [ ] Add integration tests for DELETE with cleanup event
- [ ] Add webhook tests for image message
- [ ] Add webhook tests for audio message
- [ ] Mock WhatsApp API calls with nock
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
cd apps/whatsapp-service
npm run test:coverage
npm run ci
```

---

## Rollback Plan

N/A - tests only.

