# 1-4: Add WhatsApp Media Download Client

**Tier:** 1 (Independent Deliverable)

---

## Context

When WhatsApp sends a webhook with audio/image, it includes a `media_id`. We must call WhatsApp's Graph API to:

1. Get media URL from media_id
2. Download the actual media binary

---

## Problem Statement

Create a client to download media from WhatsApp API:

- GET /v21.0/{media_id} → returns download URL
- GET download URL with auth → returns binary
- Handle errors and retries

---

## Scope

**In scope:**

- Add getMediaUrl(mediaId) → MediaUrlResponse
- Add downloadMedia(url) → Buffer
- Handle auth with access token
- Error handling for API failures
- Add types for WhatsApp media response

**Out of scope:**

- Integration with webhook (later task)
- GCS upload (uses existing adapter)

---

## Required Approach

1. Extend whatsappClient.ts with media functions
2. Define MediaUrlResponse type
3. Implement getMediaUrl using fetch
4. Implement downloadMedia using fetch with auth
5. Return buffer for storage

---

## Step Checklist

- [ ] Define MediaUrlResponse interface (url, mime_type, sha256, file_size)
- [ ] Add getMediaUrl(mediaId, accessToken) function
- [ ] Add downloadMedia(url, accessToken) function
- [ ] Handle HTTP errors with meaningful messages
- [ ] Add timeout handling
- [ ] Export new functions
- [ ] Run npm run typecheck
- [ ] Run npm run lint

---

## Definition of Done

- Media URL retrieval working
- Media download returns buffer
- Error handling in place
- Types exported
- Typecheck passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

Remove new functions from whatsappClient.ts.
