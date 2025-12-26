# 1-2: Add Thumbnail Generation Service

**Tier:** 1 (Independent Deliverable)

---

## Context

Images received via WhatsApp need thumbnails for efficient display in the web app. Thumbnails are 256px max on longest edge.

---

## Problem Statement

Create a thumbnail generation service using sharp library:

- Resize to 256px max on longest edge
- Maintain aspect ratio
- Output as JPEG for smaller size
- Handle various input formats (JPEG, PNG, WebP)

---

## Scope

**In scope:**

- Add sharp dependency
- Create thumbnail generation utility
- Define interface for thumbnail generator
- Handle image format detection
- Output as JPEG with reasonable quality

**Out of scope:**

- Integration with webhook (later task)
- GCS upload (uses existing adapter)

---

## Required Approach

1. Add sharp to package.json
2. Create utility function that takes buffer, returns thumbnail buffer
3. Use sharp to resize maintaining aspect ratio
4. Output as JPEG (quality ~80)
5. Return both buffer and content type

---

## Step Checklist

- [ ] Add sharp to apps/whatsapp-service/package.json
- [ ] Create `src/infra/media/thumbnailGenerator.ts`
- [ ] Define generateThumbnail(buffer: Buffer) → { buffer: Buffer, mimeType: string }
- [ ] Implement with sharp, 256px max edge
- [ ] Handle errors gracefully (return null on failure)
- [ ] Add unit tests for thumbnail generation
- [ ] Run npm install
- [ ] Run npm run typecheck
- [ ] Run npm run lint
- [ ] Run npm run test

---

## Definition of Done

- sharp installed and working
- Thumbnail generator produces correct sized images
- Returns JPEG output
- Unit tests pass
- Typecheck passes

---

## Verification Commands

```bash
cd apps/whatsapp-service
npm install
npm run typecheck
npm run lint
npm run test
```

---

## Rollback Plan

Remove sharp dependency, delete thumbnailGenerator.ts and tests.
