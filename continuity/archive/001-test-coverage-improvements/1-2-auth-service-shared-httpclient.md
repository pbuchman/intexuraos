# 1-2 - Add Tests for user-service Shared and HTTP Client

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
- Mock external systems only
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Test location: `apps/user-service/src/__tests__/`

### Changes from Tier 0

- Coverage exclusions have been narrowed (see 0-0)
- Test utility patterns documented (see 0-2)

---

## Problem Statement

Current coverage:

- `apps/user-service/src/routes/v1/shared.ts`: **75%** (lines 49-56 uncovered)
- `apps/user-service/src/routes/v1/httpClient.ts`: **87.5%** (lines 46-48, 54-55, 61 uncovered)

These utility files contain reusable logic for auth routes and need better coverage.

---

## Scope

### In Scope

- `apps/user-service/src/routes/v1/shared.ts`
- `apps/user-service/src/routes/v1/httpClient.ts`

### Out of Scope

- Route handlers (covered by other Tier 1 issues)
- External HTTP calls (mock the fetch)

---

## Required Approach

- **Testing style**: Unit tests for utility functions
- **Mocking strategy**:
  - Mock `fetch` for httpClient
  - Mock Fastify request/reply for shared utilities
- **Architecture boundaries**: Test exported functions directly

---

## Steps

1. Read source files:

===
cat apps/user-service/src/routes/v1/shared.ts
cat apps/user-service/src/routes/v1/httpClient.ts
===

2. Identify uncovered code:
   - shared.ts lines 49-56: likely error handling
   - httpClient.ts lines 46-48, 54-55, 61: likely HTTP error scenarios

3. Create test files if they don't exist:
   - `apps/user-service/src/__tests__/shared.test.ts`
   - `apps/user-service/src/__tests__/httpClient.test.ts`

4. Add unit tests for:
   - shared.ts: All exported utility functions
   - httpClient.ts:
     - postFormUrlEncoded success
     - postFormUrlEncoded network error
     - postFormUrlEncoded non-200 response
     - toFormUrlEncodedBody edge cases

5. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] `apps/user-service/src/routes/v1/shared.ts` coverage ≥ 95%
- [ ] `apps/user-service/src/routes/v1/httpClient.ts` coverage ≥ 95%
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If fetch mocking causes issues:

1. Use `vi.stubGlobal('fetch', mockFetch)`
2. Ensure cleanup in afterEach
