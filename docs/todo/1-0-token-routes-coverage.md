# 1-0 - Token Routes Coverage (53% → 90%)

**Tier:** 1 (Depends on: 0-0-review-exclusions.md, 0-1-test-utility-improvements.md)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90/85/85/90 (lines/branches/functions/statements)
- Test runner: Vitest with v8 coverage provider
- Architecture: Routes in `src/routes/v1/`, infra adapters in `src/infra/`
- Mock external systems only (Auth0, Firestore)
- Colocated infra tested via integration tests through routes
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Current coverage: tokenRoutes.ts at 53.9%
- Uncovered lines: 85-147, 155-173

---

## Problem Statement

`apps/auth-service/src/routes/v1/tokenRoutes.ts` has only 53.9% line coverage. The uncovered lines (85-147, 155-173) contain:
- Token refresh logic
- Error handling paths
- Auth0 client interactions
- Firestore token repository operations

This is a critical auth flow that needs comprehensive test coverage.

---

## Scope

### In Scope

- `apps/auth-service/src/routes/v1/tokenRoutes.ts`
- `apps/auth-service/src/__tests__/tokenRoutes.test.ts` (create or extend)
- Mocking Auth0 client responses
- Mocking Firestore token repository

### Out of Scope

- Changes to production code logic
- Testing actual Auth0 or Firestore (mock only)
- Other route files

---

## Required Approach

- **Integration tests** - Test via Fastify injection
- **Mock strategy**:
  - Mock `Auth0ClientImpl` to return controlled responses
  - Mock `FirestoreAuthTokenRepository` for token storage
  - Test happy path and all error branches
- **Architecture boundaries**: Only test observable HTTP behavior

---

## Steps

1. Read the source file to understand the logic:

===
cat apps/auth-service/src/routes/v1/tokenRoutes.ts
===

2. Read existing tests:

===
cat apps/auth-service/src/__tests__/tokenRoutes.test.ts
===

3. Identify untested branches (lines 85-147, 155-173):
   - Config missing scenarios
   - Token repository errors
   - Refresh token not found
   - Auth0 refresh errors
   - Invalid grant handling
   - Downstream errors

4. Add test cases for each uncovered branch:

   a. Test config validation error paths:
   - Missing Auth0 domain
   - Missing Auth0 client ID

   b. Test token retrieval errors:
   - Firestore error when getting refresh token
   - No refresh token found (user must re-auth)

   c. Test Auth0 refresh errors:
   - Invalid grant (expired token)
   - Network/downstream errors
   - Unexpected error state

   d. Test successful refresh with token rotation

5. Use the mock patterns from testUtils.ts for Fastify injection

6. Ensure all mocks properly implement the interface contracts

---

## Definition of Done

- [ ] tokenRoutes.ts line coverage ≥ 90%
- [ ] tokenRoutes.ts branch coverage ≥ 85%
- [ ] All error paths have explicit tests
- [ ] Happy path tested with token rotation
- [ ] `npm run ci` passes
- [ ] No flaky tests introduced

---

## Verification Commands

Check specific file coverage:
===
npm run test:coverage 2>&1 | grep "tokenRoutes.ts"
===

Run full CI:
===
npm run ci
===

---

## Rollback Plan

If tests become flaky:
1. Check for async timing issues
2. Ensure mocks are reset between tests
3. If persistent issues, skip flaky tests with `it.skip` and document the issue

