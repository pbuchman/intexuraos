# 1-2: Create ProcessAudioMessageUseCase

## Tier
1 (Independent Deliverable)

## Context
Audio message processing logic (~150 lines) is embedded in webhookRoutes.ts.

## Problem Statement
`processAudioMessage()` function in webhookRoutes.ts handles:
1. Get media URL from WhatsApp
2. Download audio
3. Upload to GCS
4. Save message to Firestore
5. Trigger async transcription (fire-and-forget)
6. Update webhook event status
7. Send confirmation message

This violates: "Routes should handle input validation and routing ONLY"

## Scope
Extract to `domain/inbox/usecases/processAudioMessage.ts`:
- Pure business logic
- Depends only on ports
- Returns saved message ID for transcription trigger

## Non-Scope
- Transcription logic (separate usecase 1-3)
- Modifying routes (Tier 2)

## Required Approach
1. Create `ProcessAudioMessageUseCase` class
2. Constructor accepts required ports
3. Single `execute()` method
4. Return message info needed for transcription

## Input Model
```typescript
interface ProcessAudioMessageInput {
  eventId: string;
  userId: string;
  waMessageId: string;
  fromNumber: string;
  toNumber: string;
  timestamp: string;
  senderName: string | null;
  phoneNumberId: string | null;
  audioMedia: {
    id: string;
    mimeType: string;
    sha256?: string;
  };
}
```

## Output Model
```typescript
interface ProcessAudioMessageResult {
  messageId: string;
  gcsPath: string;
  mimeType: string;
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
- Audio processing logic extracted
- `npm run typecheck` passes

## Verification Commands
```bash
npm run typecheck
npm run lint
```

## Rollback Plan
Delete usecase file, revert index.ts

