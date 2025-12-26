# 3-0: Update Web App for Media Display

**Tier:** 3 (UI Integration)

**Depends on:** 2-0, 2-1, 2-2

---

## Context

Web app needs to display media in the WhatsApp messages list:

- Images: show thumbnail, click opens modal with full-size + download
- Audio: show mini-player with play/pause and seeking

---

## Problem Statement

Extend WhatsAppNotesPage and related components:

- Detect message mediaType
- Fetch signed URLs from API
- Display thumbnail for images
- Display audio player for audio
- Modal component for full-size image viewing

---

## Scope

**In scope:**

- Extend WhatsAppMessage type in frontend
- Create ImageModal component
- Create AudioPlayer component
- Modify MessageItem for media display
- Fetch signed URLs on demand
- Handle loading/error states

**Out of scope:**

- Transcription display (future)
- Video messages

---

## Required Approach

1. Update types/index.ts with media fields
2. Update services to include media URL endpoints
3. Create ImageModal with signed URL fetch on open
4. Create AudioPlayer with HTML5 audio element
5. Modify MessageItem to show media based on type
6. Add loading states while fetching URLs

---

## Step Checklist

- [ ] Update WhatsAppMessage type with mediaType, thumbnailUrl?, hasMedia?
- [ ] Add getMessageMedia(token, messageId) to services
- [ ] Add getMessageThumbnail(token, messageId) to services
- [ ] Create `src/components/ImageModal.tsx`
- [ ] Fetch full image URL when modal opens
- [ ] Display image with loading state
- [ ] Add download button
- [ ] Create `src/components/AudioPlayer.tsx`
- [ ] Use HTML5 audio element
- [ ] Fetch signed URL on mount
- [ ] Add play/pause, seeking, progress
- [ ] Modify MessageItem in WhatsAppNotesPage
- [ ] Show thumbnail for image messages
- [ ] Show AudioPlayer for audio messages
- [ ] Handle click on thumbnail to open modal
- [ ] Run npm run typecheck
- [ ] Run npm run lint

---

## Definition of Done

- Image thumbnails displayed in list
- Modal shows full-size on click
- Audio player works with seeking
- Loading states handled
- Typecheck passes

---

## Verification Commands

```bash
cd apps/web
npm run typecheck
npm run lint
```

---

## Rollback Plan

Revert component changes, remove new components.
