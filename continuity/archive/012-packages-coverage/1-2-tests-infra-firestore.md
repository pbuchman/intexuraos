# Task 1-2: Tests for infra-firestore

## Tier

1 - Independent deliverable

## Context

packages/infra-firestore contains:

- firestore.ts: Firestore singleton (getFirestore, resetFirestore, setFirestore)
- testing/firestoreFake.ts: Fake Firestore implementation for testing

## Problem Statement

No tests exist for infra-firestore. Need high coverage.

Note: firestore.ts is excluded in vitest.config.ts with justification "Pure singleton getter with no business logic".
Focus on testing firestoreFake.ts which has substantial logic.

## Scope

- packages/infra-firestore/src/**tests**/firestoreFake.test.ts

## Non-Scope

- firestore.ts (singleton, excluded)
- index.ts (barrel file)
- testing/index.ts (barrel file)

## Required Approach

### firestoreFake.test.ts

Test FakeFirestore operations:

- collection().doc().set() and get()
- collection().doc().update() and delete()
- Query operations: where, orderBy, limit, startAfter
- Query filter operators: ==, !=, <, <=, >, >=, array-contains
- FakeQuerySnapshot: docs, empty, size
- FakeDocumentSnapshot: id, exists, data(), ref
- configure() with errorToThrow
- clear() and getAllData()
- seedCollection()
- listCollections()
- batch() operations: delete, set, update, commit
- Auto-generated doc IDs

## Step Checklist

- [ ] Create firestoreFake.test.ts with comprehensive tests
- [ ] Test all query operations
- [ ] Test all document operations
- [ ] Test batch operations
- [ ] Test error injection via configure()
- [ ] Run tests and verify pass

## Definition of Done

firestoreFake.ts has high test coverage (>90%)

## Verification Commands

```bash
npm run test -- packages/infra-firestore --coverage
```

## Rollback Plan

Delete test files if task fails
