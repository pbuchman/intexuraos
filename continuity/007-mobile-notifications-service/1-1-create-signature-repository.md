# 1-1: Create Signature Repository

## Tier

1 (Independent)

## Context

Repository for managing signature connections (user ↔ signature token mapping).

## Problem Statement

Need to:

- Store signature hash linked to userId
- Look up userId by signature hash
- Support multiple signatures per user (different devices)

## Scope

- Port interface in `src/domain/notifications/ports/`
- Firestore adapter in `src/infra/firestore/`
- Fake implementation for tests

## Non-Scope

- Signature generation logic (in usecase)
- Routes

## Required Approach

1. Define port interface
2. Implement Firestore adapter
3. Create fake for testing

## Port Interface

```typescript
interface SignatureConnectionRepository {
  save(connection: SignatureConnection): Promise<Result<void, RepositoryError>>;
  findBySignatureHash(hash: string): Promise<Result<SignatureConnection | null, RepositoryError>>;
  findByUserId(userId: string): Promise<Result<SignatureConnection[], RepositoryError>>;
  delete(id: string): Promise<Result<void, RepositoryError>>;
}
```

## Step Checklist

- [ ] Create src/domain/notifications/ports/signatureConnectionRepository.ts
- [ ] Create src/infra/firestore/firestoreSignatureConnectionRepository.ts
- [ ] Create fake implementation in **tests**/fakes.ts
- [ ] Add to services.ts

## Definition of Done

- Port and adapter implemented
- Fake ready for testing
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
```

## Rollback Plan

Delete created files
