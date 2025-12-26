# 2-2: Add Message Media Routes (Signed URLs)

**Tier:** 2 (Integration)

**Depends on:** 1-0, 1-1, 2-0, 2-1

---

## Context

Web app needs to access media in private GCS bucket. Backend must generate short-lived signed URLs.

---

## Problem Statement

Add routes to messageRoutes.ts for media access:

- GET /v1/whatsapp/messages/:id/media → signed URL for original
- GET /v1/whatsapp/messages/:id/thumbnail → signed URL for thumbnail
- Verify ownership before generating URL

---

## Scope

**In scope:**

- Add /media endpoint returning signed URL
- Add /thumbnail endpoint returning signed URL
- Verify user owns the message
- Return 404 if no media or not found
- Configurable TTL (default 15 min)

**Out of scope:**

- Audio player logic (web task)
- Image modal (web task)

---

## Required Approach

1. Add GET route for media
2. Verify auth and ownership
3. Check message has media (gcsPath)
4. Generate signed URL using media storage adapter
5. Return URL in response
6. Similar for thumbnail

---

## Step Checklist

- [x] Add GET /v1/whatsapp/messages/:id/media route
- [x] Verify auth with requireAuth
- [x] Get message from repository
- [x] Verify userId matches
- [x] Check gcsPath exists
- [x] Generate signed URL (15 min TTL)
- [x] Return { url, expiresAt }
- [x] Add GET /v1/whatsapp/messages/:id/thumbnail route
- [x] Same flow but use thumbnailGcsPath
- [x] Update OpenAPI schema
- [x] Add integration tests
- [x] Run npm run typecheck
- [x] Run npm run lint
- [x] Run npm run test

---

## Definition of Done

- Both endpoints working
- Ownership verified
- Signed URLs generated
- OpenAPI documented
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

Remove new routes from messageRoutes.ts.
