# 1-1: Create ProcessImageMessageUseCase

## Tier

1 (Independent Deliverable)

## Context

Image message processing logic (~200 lines) is embedded in webhookRoutes.ts.

## Problem Statement

`processImageMessage()` function in webhookRoutes.ts handles:

1. Get media URL from WhatsApp
2. Download image
3. Generate thumbnail
4. Upload original to GCS
5. Upload thumbnail to GCS
6. Save message to Firestore
7. Update webhook event status
8. Send confirmation message

This violates: "Routes should handle input validation and routing ONLY"

## Scope

Extract to `domain/inbox/usecases/processImageMessage.ts`:

- Pure business logic
- Depends only on ports (no infra imports)
- Testable with fake ports

## Non-Scope

- Modifying routes (Tier 2)
- Writing tests (Tier 2)

## Required Approach

1. Create `ProcessImageMessageUseCase` class
2. Constructor accepts all required ports
3. Single `execute()` method with typed input/output
4. Export from domain/inbox/index.ts

## Input Model

```typescript
interface ProcessImageMessageInput {
  eventId: string;
  userId: string;
  waMessageId: string;
  fromNumber: string;
  toNumber: string;
  timestamp: string;
  senderName: string | null;
  phoneNumberId: string | null;
  imageMedia: {
    id: string;
    mimeType: string;
    sha256?: string;
    caption?: string;
  };
}
```

## Step Checklist

- [ ] Create usecase file
- [ ] Define input/output types
- [ ] Implement execute() method
- [ ] Export from index.ts
- [ ] Run typecheck

## Definition of Done

- Usecase class created
- All logic extracted (no business logic remains for image processing in routes)
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

Delete usecase file, revert index.ts
