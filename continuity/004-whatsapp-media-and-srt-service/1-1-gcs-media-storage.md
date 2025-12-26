# 1-1: Add GCS Media Storage Port and Adapter

**Tier:** 1 (Independent Deliverable)

---

## Context

whatsapp-service needs to upload, download, and delete media from GCS bucket. Also needs to generate signed URLs for browser access.

---

## Problem Statement

Create a port (interface) and adapter (implementation) for GCS operations:
- Upload media (original + thumbnail)
- Delete media
- Generate signed URLs with configurable TTL
- Deterministic path generation

---

## Scope

**In scope:**
- Define `MediaStoragePort` interface in domain layer
- Implement `GcsMediaStorageAdapter` in infra layer
- Path generation: `whatsapp/{userId}/{messageId}/{mediaId}.{ext}`
- Thumbnail path: `whatsapp/{userId}/{messageId}/{mediaId}_thumb.{ext}`
- Signed URL generation (15 min TTL default)
- Add to service container (services.ts)
- Create fake for testing

**Out of scope:**
- Thumbnail generation logic (separate task)
- Actual webhook integration

---

## Required Approach

1. Define port interface with upload, delete, getSignedUrl methods
2. Implement adapter using @google-cloud/storage
3. Implement path generation helpers
4. Add to service container with DI
5. Create fake repository for tests

---

## Step Checklist

- [ ] Create `src/domain/inbox/ports/mediaStorage.ts` with MediaStoragePort
- [ ] Define upload(userId, messageId, mediaId, ext, buffer) → gcsPath
- [ ] Define uploadThumbnail(userId, messageId, mediaId, ext, buffer) → gcsPath
- [ ] Define delete(gcsPath) → void
- [ ] Define getSignedUrl(gcsPath, ttlSeconds?) → url
- [ ] Create `src/infra/gcs/` directory
- [ ] Create `src/infra/gcs/mediaStorageAdapter.ts`
- [ ] Implement GcsMediaStorageAdapter
- [ ] Add @google-cloud/storage to package.json
- [ ] Add to services.ts container
- [ ] Create FakeMediaStorageRepository in __tests__/fakes.ts
- [ ] Export from domain index
- [ ] Update config.ts to read WHATSAPP_MEDIA_BUCKET
- [ ] Run npm run typecheck
- [ ] Run npm run lint

---

## Definition of Done

- Port interface defined in domain layer
- Adapter implemented with GCS SDK
- Path generation follows schema
- Signed URLs generated with configurable TTL
- Fake available for testing
- Typecheck passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

Remove port, adapter, and related changes. Remove @google-cloud/storage dependency.

