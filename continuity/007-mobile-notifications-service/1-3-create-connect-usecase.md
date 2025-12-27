# 1-3: Create Connect Usecase

## Tier

1 (Independent)

## Context

Usecase for generating a new signature and linking it to a user.

## Problem Statement

When user calls `/connect`:

1. Generate crypto-secure random token
2. Hash it with SHA-256
3. Store hash linked to userId
4. Return plaintext token (only time it's visible)

## Scope

- CreateConnectionUseCase in `src/domain/notifications/usecases/`
- Crypto-secure token generation
- SHA-256 hashing
- Unit tests

## Non-Scope

- Routes
- Signature verification (separate usecase)

## Required Approach

```typescript
interface CreateConnectionInput {
  userId: string;
  deviceLabel?: string;
}

interface CreateConnectionOutput {
  connectionId: string;
  signature: string; // plaintext, only returned once
}
```

## Implementation Details

1. Generate 32 bytes of crypto-secure random
2. Encode as hex (64 characters)
3. SHA-256 hash for storage
4. Return plaintext to user

## Step Checklist

- [ ] Create src/domain/notifications/usecases/createConnection.ts
- [ ] Implement secure token generation
- [ ] Implement SHA-256 hashing
- [ ] Create unit tests
- [ ] Verify tests pass

## Definition of Done

- Usecase implemented
- Token generation cryptographically secure
- Tests passing with 90%+ coverage
- `npm run test:coverage` passes

## Verification Commands

```bash
npm run test:coverage
```

## Rollback Plan

Delete usecase file and tests
