# 1-1 - Add Tests for auth-service Device Routes

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
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Test location: `apps/auth-service/src/__tests__/`

### Changes from Tier 0

- Coverage exclusions have been narrowed (see 0-0)
- Test utility patterns documented (see 0-2)

---

## Problem Statement

Current coverage for `apps/auth-service/src/routes/v1/deviceRoutes.ts`: **77.86%**

Uncovered lines: 165-169, 265-269, 280-320

These uncovered sections include error handling paths and edge cases in the device authorization flow.

---

## Scope

### In Scope

- `apps/auth-service/src/routes/v1/deviceRoutes.ts`
- Extend `apps/auth-service/src/__tests__/deviceRoutes.test.ts`

### Out of Scope

- Other route files
- Auth0 client implementation details

---

## Required Approach

- **Testing style**: Integration tests using Fastify injection
- **Mocking strategy**:
  - Mock Auth0 device authorization responses
  - Mock Firestore for token storage
  - Use existing fakes from test file
- **Architecture boundaries**: Test through HTTP layer

---

## Steps

1. Read source file to identify uncovered branches:

===
cat apps/auth-service/src/routes/v1/deviceRoutes.ts
===

2. Read existing tests:

===
cat apps/auth-service/src/**tests**/deviceRoutes.test.ts
===

3. Identify missing test cases for lines 165-169, 265-269, 280-320:
   - Look for error conditions not yet tested
   - Look for edge cases in device flow

4. Add tests for:
   - Device poll timeout scenarios
   - Device code expiration
   - Network errors during device flow
   - Invalid device code format

5. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] `apps/auth-service/src/routes/v1/deviceRoutes.ts` coverage ≥ 90%
- [ ] Lines 165-169, 265-269, 280-320 covered
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If new tests cause timeouts:

1. Reduce timeout values in mocks
2. Use `vi.useFakeTimers()` for time-dependent tests
