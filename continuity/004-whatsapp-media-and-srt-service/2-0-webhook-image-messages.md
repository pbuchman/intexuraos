# 2-0: Extend Webhook to Accept Image Messages

**Tier:** 2 (Integration)

**Depends on:** 1-0, 1-1, 1-2, 1-4

---

## Context

WhatsApp webhook currently only accepts text messages. Need to extend to accept image messages with:
- Image download from WhatsApp API
- Thumbnail generation
- Storage in GCS
- Caption processing (if present)

---

## Problem Statement

Modify processWhatsAppWebhook use case to:
- Recognize image message type
- Extract media_id from payload
- Download image via WhatsApp API
- Generate thumbnail
- Upload both to GCS
- Store message with GCS paths
- Handle caption as text content

---

## Scope

**In scope:**
- Update webhook payload types for image
- Update classifyWebhook to accept image type
- Implement image processing flow
- Store with mediaType = 'image'
- Extract and store caption if present

**Out of scope:**
- Audio messages (next task)
- Web display (later task)

---

## Required Approach

1. Extend WhatsAppWebhookPayload types for image
2. Update classifyWebhook to return VALID for image type
3. Create processImageMessage helper
4. Download, generate thumbnail, upload both
5. Create message record with paths
6. Handle caption in text field

---

## Step Checklist

- [ ] Update WhatsAppWebhookPayload with image message type
- [ ] Update classifyWebhook to accept 'image' type
- [ ] Extract image.id, image.mime_type, image.sha256
- [ ] Extract image.caption if present
- [ ] Create processImageMessage use case
- [ ] Download image using whatsappClient
- [ ] Generate thumbnail using thumbnailGenerator
- [ ] Upload original to GCS
- [ ] Upload thumbnail to GCS
- [ ] Create WhatsAppMessage with mediaType='image'
- [ ] Store gcsPath and thumbnailGcsPath
- [ ] Set caption as text if present, else empty
- [ ] Add integration tests with mocked WhatsApp API
- [ ] Run npm run typecheck
- [ ] Run npm run lint
- [ ] Run npm run test

---

## Definition of Done

- Image messages accepted by webhook
- Images stored in GCS with thumbnails
- Caption stored as text content
- Message record has correct paths
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

Revert changes to processWhatsAppWebhook.ts and related files.

