# 1-0: Create Domain Models

## Tier

1 (Independent)

## Context

Define TypeScript types/interfaces for the mobile notifications domain.

## Problem Statement

Need type-safe models for:

- Notification entity
- Signature/connection entity
- API request/response types

## Scope

- Create `src/domain/notifications/models/` with all types
- Notification model with all fields
- SignatureConnection model
- Request/response DTOs

## Non-Scope

- Repository implementations
- Usecases

## Required Approach

Follow existing pattern from whatsapp-service domain models.

## Models to Create

### Notification

```typescript
interface Notification {
  id: string;
  userId: string;
  source: string;
  device: string;
  app: string;
  title: string;
  text: string;
  timestamp: number; // from device
  receivedAt: string; // ISO string, server time
  notificationId: string; // idempotency key from device
}
```

### SignatureConnection

```typescript
interface SignatureConnection {
  id: string;
  userId: string;
  signatureHash: string; // SHA-256 of the actual signature
  deviceLabel?: string; // optional metadata
  createdAt: string;
}
```

## Step Checklist

- [ ] Create src/domain/notifications/models/notification.ts
- [ ] Create src/domain/notifications/models/signatureConnection.ts
- [ ] Create src/domain/notifications/models/index.ts (barrel export)
- [ ] Verify types compile

## Definition of Done

- All models defined with proper TypeScript types
- Barrel export working
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
```

## Rollback Plan

Delete src/domain/notifications/models/
