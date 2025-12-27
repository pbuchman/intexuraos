# 1-6: Create Delete Notification Usecase

## Tier

1 (Independent)

## Context

Usecase for deleting a notification with ownership verification.

## Problem Statement

User wants to delete a notification:

- Must verify ownership (userId matches)
- Hard delete (no soft delete)
- Return appropriate error if not found or not owned

## Scope

- DeleteNotificationUseCase
- Ownership verification
- Unit tests

## Non-Scope

- Routes
- Confirmation UI (handled in frontend)

## Required Approach

```typescript
interface DeleteNotificationInput {
  notificationId: string;
  userId: string;
}

type DeleteNotificationResult =
  | { ok: true }
  | { ok: false; error: { code: 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_ERROR'; message: string } };
```

## Implementation Steps

1. Fetch notification by ID
2. If not found → NOT_FOUND error
3. If userId doesn't match → FORBIDDEN error
4. Delete notification
5. Return success

## Step Checklist

- [ ] Create src/domain/notifications/usecases/deleteNotification.ts
- [ ] Implement ownership check
- [ ] Create unit tests for all branches
- [ ] Verify tests pass

## Definition of Done

- Usecase implemented
- All error cases tested
- `npm run test:coverage` passes

## Verification Commands

```bash
npm run test:coverage
```

## Rollback Plan

Delete usecase file and tests
