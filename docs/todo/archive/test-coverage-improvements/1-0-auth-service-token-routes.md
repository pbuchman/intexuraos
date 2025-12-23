# 1-0 - Add Tests for auth-service Token Routes

**Tier:** 1 (Depends on: ALL Tier 0 issues must be complete)

---

## Prerequisites

Before starting this issue, ensure these are complete:

- [x] `0-0-narrow-coverage-exclusions.md` - Coverage config is cleaned up
- [x] `0-1-common-package-coverage.md` - Common utilities are tested
- [x] `0-2-standardize-test-utilities.md` - Test patterns are documented

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90%
- Test runner: Vitest with v8 coverage provider
- Apps import only from `@praxos/common`
- Mock external systems only (Auth0, Firestore)
- Colocated infra in `src/infra/**`
- Routes in `src/routes/v1/**`
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Test location: `apps/auth-service/src/__tests__/`

### Changes from Tier 0

- Coverage exclusions have been narrowed (see 0-0)
- Common package test patterns established (see 0-1)
- Test utility patterns documented (see 0-2)

---

## Problem Statement

Current coverage for `apps/auth-service/src/routes/v1/tokenRoutes.ts`: **43.97%**

Uncovered lines: 77-174 (most of the file)

This file handles token refresh operations and is critical for auth flows but has very low test coverage.

---

## Scope

### In Scope

- `apps/auth-service/src/routes/v1/tokenRoutes.ts`
- Create or extend `apps/auth-service/src/__tests__/tokenRoutes.test.ts`

### Out of Scope

- Other route files (covered by separate Tier 1 issues)
- Infrastructure adapters (Tier 2 issue)

---

## Required Approach

- **Testing style**: Integration tests using Fastify injection
- **Mocking strategy**:
  - Mock Auth0 client responses
  - Mock Firestore token repository
  - Use patterns established in 0-2
- **Architecture boundaries**: Test through HTTP layer, not internal functions

---

## Steps

1. Read the source file to understand the routes:

===
cat apps/auth-service/src/routes/v1/tokenRoutes.ts
===

2. Read existing test patterns (established in 0-2):

===
cat apps/auth-service/src/**tests**/deviceRoutes.test.ts
cat apps/auth-service/src/**tests**/frontendRoutes.test.ts
===

3. Identify test cases needed:
   - POST /v1/auth/refresh with valid refresh token
   - POST /v1/auth/refresh with invalid/expired token
   - POST /v1/auth/refresh with missing token
   - POST /v1/auth/refresh when Auth0 returns error
   - POST /v1/auth/refresh when Firestore fails

4. Create test file `apps/auth-service/src/__tests__/tokenRoutes.test.ts` if not exists, or extend it

5. Implement tests following existing patterns

6. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] `apps/auth-service/src/routes/v1/tokenRoutes.ts` coverage ≥ 85%
- [ ] All happy path scenarios tested
- [ ] Error scenarios tested (invalid token, Auth0 errors, Firestore errors)
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If tests are flaky due to timing issues:

1. Add explicit waits or use Vitest's async utilities
2. If Auth0 mock is unreliable, simplify mock responses
