# 1-3: Create TranscribeAudioUseCase

## Tier
1 (Independent Deliverable)

## Context
Audio transcription logic (~250 lines) is embedded in webhookRoutes.ts as `transcribeAudioAsync()`.

## Problem Statement
`transcribeAudioAsync()` function handles:
1. Initialize transcription state as pending
2. Get signed URL for audio file
3. Submit job to Speechmatics
4. Poll until completion (with exponential backoff)
5. Fetch transcript
6. Update message with transcription
7. Send success/failure message to user

This is the largest single function (~250 lines) and violates architecture patterns.

## Scope
Extract to `domain/inbox/usecases/transcribeAudio.ts`:
- Complete transcription workflow
- Polling configuration as constructor param
- Depends only on ports

## Non-Scope
- Modifying routes (Tier 2)
- Changing polling algorithm

## Required Approach
1. Create `TranscribeAudioUseCase` class
2. Polling config as constructor parameter (testable)
3. Single `execute()` method
4. Include all messaging (success/failure)

## Input Model
```typescript
interface TranscribeAudioInput {
  messageId: string;
  userId: string;
  gcsPath: string;
  mimeType: string;
  userPhoneNumber: string;
  originalWaMessageId: string;
  phoneNumberId: string;
}
```

## Polling Config
```typescript
interface TranscriptionPollingConfig {
  initialDelayMs: number;     // default: 2000
  maxDelayMs: number;         // default: 30000
  backoffMultiplier: number;  // default: 1.5
  maxAttempts: number;        // default: 60
}
```

## Step Checklist
- [ ] Create usecase file
- [ ] Define input types and polling config
- [ ] Implement execute() method with polling logic
- [ ] Export from index.ts
- [ ] Run typecheck

## Definition of Done
- Usecase class created
- Complete transcription workflow extracted
- Polling is configurable (for testing)
- `npm run typecheck` passes

## Verification Commands
```bash
npm run typecheck
npm run lint
```

## Rollback Plan
Delete usecase file, revert index.ts

