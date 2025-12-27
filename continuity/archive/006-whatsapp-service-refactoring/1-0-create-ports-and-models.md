# 1-0: Create Ports and Models for Usecase Extraction

## Tier

1 (Independent Deliverable)

## Context

Before extracting usecases, we need clean port interfaces that abstract external dependencies.

## Problem Statement

Current webhookRoutes.ts directly calls:

- `getMediaUrl()`, `downloadMedia()` from whatsappClient.ts
- `generateThumbnail()` from infra/media
- `sendWhatsAppMessage()` from whatsappClient.ts

These must be abstracted behind ports for testability.

## Scope

Create port interfaces:

1. `WhatsAppCloudApiPort` - media URL fetching, downloading, message sending
2. `ThumbnailGeneratorPort` - image thumbnail generation

## Non-Scope

- Implementing adapters (they exist, just need port interfaces)
- Modifying routes (Tier 2)

## Required Approach

1. Create `ports/whatsappCloudApi.ts` with interface
2. Create `ports/thumbnailGenerator.ts` with interface
3. Export from `domain/inbox/index.ts`
4. Update `services.ts` ServiceContainer type

## Step Checklist

- [ ] Create WhatsAppCloudApiPort interface
- [ ] Create ThumbnailGeneratorPort interface
- [ ] Export from domain/inbox/index.ts
- [ ] Update ServiceContainer in services.ts
- [ ] Run typecheck

## Definition of Done

- Port interfaces defined
- Exported from domain layer
- ServiceContainer updated
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

Delete created port files, revert index.ts and services.ts changes
