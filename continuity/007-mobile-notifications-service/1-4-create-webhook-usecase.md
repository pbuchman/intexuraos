# 1-4: Create Webhook Usecase

## Tier

1 (Independent)

## Context

Usecase for processing incoming notifications from mobile devices.

## Problem Statement

When webhook receives notification:

1. Verify signature (hash and lookup)
2. Check idempotency (notification_id per user)
3. Store notification if new
4. Return appropriate status

## Scope

- ProcessNotificationUseCase
- Signature verification
- Idempotency check
- Unit tests

## Non-Scope

- Routes
- HTTP response formatting

## Required Approach

```typescript
interface ProcessNotificationInput {
  signature: string; // from header
  payload: {
    source: string;
    device: string;
    timestamp: number;
    notification_id: string;
    post_time: string;
    app: string;
    title: string;
    text: string;
  };
}

interface ProcessNotificationOutput {
  status: 'accepted' | 'ignored';
  id?: string; // only if accepted
}
```

## Implementation Steps

1. Hash incoming signature
2. Look up userId by hash
3. If not found → ignored
4. Check if notification_id exists for user → ignored
5. Create notification with server timestamp
6. Save to repository
7. Return accepted with ID

## Step Checklist

- [ ] Create src/domain/notifications/usecases/processNotification.ts
- [ ] Implement signature verification
- [ ] Implement idempotency check
- [ ] Create unit tests for all branches
- [ ] Verify tests pass

## Definition of Done

- Usecase implemented
- All edge cases tested
- 90%+ coverage
- `npm run test:coverage` passes

## Verification Commands

```bash
npm run test:coverage
```

## Rollback Plan

Delete usecase file and tests
