# 1-2: Create Notification Repository

## Tier

1 (Independent)

## Context

Repository for storing and retrieving mobile notifications.

## Problem Statement

Need to:

- Store notifications linked to userId
- List notifications with cursor-based pagination
- Check for duplicates (notification_id per user)
- Delete notifications

## Scope

- Port interface
- Firestore adapter with pagination
- Fake implementation for tests

## Non-Scope

- Webhook logic
- Routes

## Required Approach

1. Define port interface with pagination support
2. Implement Firestore adapter with cursor queries
3. Create fake for testing

## Port Interface

```typescript
interface NotificationRepository {
  save(notification: Notification): Promise<Result<void, RepositoryError>>;
  findById(id: string): Promise<Result<Notification | null, RepositoryError>>;
  findByUserIdPaginated(
    userId: string,
    options: { limit: number; cursor?: string }
  ): Promise<Result<{ notifications: Notification[]; nextCursor?: string }, RepositoryError>>;
  existsByNotificationIdAndUserId(
    notificationId: string,
    userId: string
  ): Promise<Result<boolean, RepositoryError>>;
  delete(id: string): Promise<Result<void, RepositoryError>>;
}
```

## Step Checklist

- [ ] Create src/domain/notifications/ports/notificationRepository.ts
- [ ] Create src/infra/firestore/firestoreNotificationRepository.ts
- [ ] Implement cursor-based pagination
- [ ] Create fake implementation
- [ ] Add to services.ts

## Definition of Done

- Port and adapter implemented
- Pagination working
- Fake ready for testing
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
```

## Rollback Plan

Delete created files
