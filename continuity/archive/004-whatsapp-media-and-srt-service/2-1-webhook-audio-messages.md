# 2-1: Extend Webhook to Accept Audio Messages + Publish Event

**Tier:** 2 (Integration)

**Depends on:** 1-0, 1-1, 1-3, 1-4

---

## Context

WhatsApp webhook needs to accept audio messages. After storing audio in GCS, publish event to trigger transcription.

---

## Problem Statement

Modify processWhatsAppWebhook to:

- Recognize audio message type
- Download audio from WhatsApp API
- Upload to GCS
- Store message with GCS path
- Publish `whatsapp.audio.stored` event
- Handle caption (voice note text) if present

---

## Scope

**In scope:**

- Update webhook payload types for audio
- Update classifyWebhook to accept audio type
- Implement audio processing flow
- Publish Pub/Sub event after storage
- Handle caption/text if present

**Out of scope:**

- srt-service processing (separate task)
- Transcription result storage

---

## Required Approach

1. Extend WhatsAppWebhookPayload for audio
2. Update classifyWebhook for audio type
3. Create processAudioMessage helper
4. Download, upload to GCS
5. Create message record
6. Publish AudioStoredEvent with message context

---

## Step Checklist

- [ ] Update WhatsAppWebhookPayload with audio message type
- [ ] Update classifyWebhook to accept 'audio' type
- [ ] Extract audio.id, audio.mime_type, audio.sha256, audio.voice
- [ ] Create processAudioMessage use case
- [ ] Download audio using whatsappClient
- [ ] Upload to GCS
- [ ] Create WhatsAppMessage with mediaType='audio'
- [ ] Store gcsPath
- [ ] Publish AudioStoredEvent with userId, messageId, mediaId, gcsPath
- [ ] Add integration tests
- [ ] Run npm run typecheck
- [ ] Run npm run lint
- [ ] Run npm run test

---

## Definition of Done

- Audio messages accepted by webhook
- Audio stored in GCS
- Message record created with path
- Event published to Pub/Sub
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
