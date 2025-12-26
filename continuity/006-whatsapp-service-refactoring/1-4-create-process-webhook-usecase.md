# 1-4: Create ProcessIncomingMessageUseCase (Orchestrator)

## Tier
1 (Independent Deliverable)

## Context
`processWebhookAsync()` in webhookRoutes.ts (~200 lines) orchestrates message processing.

## Problem Statement
This function:
1. Extracts sender phone number
2. Validates message type (text/image/audio)
3. Validates message content
4. Looks up user by phone number
5. Checks user connection status
6. Routes to appropriate processor (text/image/audio)
7. Saves text messages directly
8. Updates webhook status

This orchestration logic belongs in domain, not routes.

## Scope
Extract to `domain/inbox/usecases/processIncomingMessage.ts`:
- Orchestration of message processing
- Delegates to specialized usecases for image/audio
- Handles text messages directly
- Returns processing result

## Non-Scope
- Image/audio processing (separate usecases)
- Modifying routes (Tier 2)

## Required Approach
1. Create `ProcessIncomingMessageUseCase` class
2. Inject specialized usecases for delegation
3. Handle text messages inline (simple save)
4. Return structured result for route to send confirmation

## Input Model
```typescript
interface ProcessIncomingMessageInput {
  eventId: string;
  payload: WebhookPayload;  // Raw webhook payload
  config: {
    allowedPhoneNumberIds: string[];
    accessToken: string;
  };
}
```

## Output Model
```typescript
type ProcessingOutcome = 
  | { status: 'processed'; messageType: 'text' | 'image' | 'audio'; messageId: string }
  | { status: 'ignored'; reason: IgnoredReason }
  | { status: 'failed'; error: string }
  | { status: 'user_unmapped'; phoneNumber: string };
```

## Step Checklist
- [ ] Create usecase file
- [ ] Define input/output types
- [ ] Implement orchestration logic
- [ ] Handle text messages directly
- [ ] Delegate image/audio to other usecases
- [ ] Export from index.ts
- [ ] Run typecheck

## Definition of Done
- Usecase class created
- All orchestration logic extracted
- Clean delegation to specialized usecases
- `npm run typecheck` passes

## Verification Commands
```bash
npm run typecheck
npm run lint
```

## Rollback Plan
Delete usecase file, revert index.ts

