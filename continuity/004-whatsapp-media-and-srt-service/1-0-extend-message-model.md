# 1-0: Extend WhatsAppMessage Model for Media

**Tier:** 1 (Independent Deliverable)

---

## Context

WhatsApp messages can now include audio or image media. The domain model must capture:
- Media type (audio/image/text)
- Media metadata (mediaId, mimeType, fileSize)
- GCS paths for original and thumbnail
- Caption text (for image/audio with text)
- Transcription job reference (for audio)

---

## Problem Statement

Current `WhatsAppMessage` model only supports text messages. Need to extend for media support while maintaining backward compatibility with existing text-only messages.

---

## Scope

**In scope:**
- Extend `WhatsAppMessage` interface with media fields
- Add `WhatsAppMediaType` type
- Add `WhatsAppMediaInfo` interface
- Update repository types if needed
- Update Firestore adapter to handle new fields

**Out of scope:**
- Webhook processing logic (next task)
- GCS operations

---

## Required Approach

1. Add media type discriminator field
2. Add optional media info (id, mimeType, fileSize, sha256)
3. Add GCS path fields (original, thumbnail)
4. Add caption field (text accompanying media)
5. Add transcription job reference for audio
6. Ensure existing text messages still work

---

## Step Checklist

- [ ] Add `WhatsAppMediaType = 'text' | 'image' | 'audio'` type
- [ ] Add `WhatsAppMediaInfo` interface
- [ ] Add `mediaType` field (default 'text' for backward compat)
- [ ] Add `media?: WhatsAppMediaInfo` field
- [ ] Add `gcsPath?: string` field
- [ ] Add `thumbnailGcsPath?: string` field
- [ ] Add `caption?: string` field (for media with text)
- [ ] Add `transcriptionJobId?: string` field
- [ ] Update repository port if needed
- [ ] Update Firestore adapter to persist new fields
- [ ] Export new types from domain index
- [ ] Run npm run typecheck
- [ ] Run npm run lint

---

## Definition of Done

- Model supports text, image, and audio message types
- Backward compatible with existing text messages
- Types exported from domain layer
- Typecheck passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

Revert changes to WhatsAppMessage.ts and related files.

