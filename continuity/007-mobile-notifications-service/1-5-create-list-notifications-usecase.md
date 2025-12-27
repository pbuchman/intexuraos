# 1-5: Create List Notifications Usecase

## Tier

1 (Independent)

## Context

Usecase for listing user's notifications with pagination.

## Problem Statement

User needs to retrieve their notifications:

- Paginated (cursor-based)
- Sorted by newest first
- Only their own notifications

## Scope

- ListNotificationsUseCase
- Pagination handling
- Unit tests

## Non-Scope

- Routes
- Authentication (handled at route level)

## Required Approach

```typescript
interface ListNotificationsInput {
  userId: string;
  limit?: number; // default 50
  cursor?: string;
}

interface ListNotificationsOutput {
  notifications: Notification[];
  nextCursor?: string;
}
```

## Step Checklist

- [ ] Create src/domain/notifications/usecases/listNotifications.ts
- [ ] Implement pagination pass-through to repository
- [ ] Create unit tests
- [ ] Verify tests pass

## Definition of Done

- Usecase implemented
- Tests passing
- `npm run test:coverage` passes

## Verification Commands

```bash
npm run test:coverage
```

## Rollback Plan

Delete usecase file and tests
