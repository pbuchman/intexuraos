# 1-5 - Auth Service Remaining Gaps (75-81% → 90%)

**Tier:** 1 (Depends on: 0-0-review-exclusions.md, 0-1-test-utility-improvements.md)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90/85/85/90 (lines/branches/functions/statements)
- Test runner: Vitest with v8 coverage provider
- Architecture: Routes in `src/routes/v1/`, shared utilities in `shared.ts`
- Mock external systems only (Auth0)
- Use Fastify injection for route testing
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Current coverage:
  - shared.ts: 75% (lines 49-56 uncovered)
  - deviceRoutes.ts: 81.67% (lines 160-261, 280-320 uncovered)

---

## Problem Statement

The auth-service has remaining coverage gaps:

1. `shared.ts` (75%): lines 49-56 - likely validation/error handling utilities
2. `deviceRoutes.ts` (81.67%): lines 160-261, 280-320 - device authorization flow

Note: tokenRoutes.ts is covered separately in 1-0.

---

## Scope

### In Scope

- `apps/auth-service/src/routes/v1/shared.ts`
- `apps/auth-service/src/routes/v1/deviceRoutes.ts`
- Extending existing test files

### Out of Scope

- tokenRoutes.ts (covered in 1-0)
- Actual Auth0 API calls
- Config loading

---

## Required Approach

- **Integration tests** - Test via Fastify injection
- **Mock strategy**:
  - Mock Auth0 device authorization responses
  - Mock token polling responses
  - Test error scenarios

---

## Steps

1. Read the source files:

===
cat apps/auth-service/src/routes/v1/shared.ts
cat apps/auth-service/src/routes/v1/deviceRoutes.ts
===

2. Read existing tests:

===
cat apps/auth-service/src/__tests__/deviceRoutes.test.ts
===

3. Identify uncovered paths in deviceRoutes.ts (lines 160-261, 280-320):
   - Likely device code request
   - Token polling loop
   - Error handling (expired, pending, denied)

4. Add tests for shared.ts (lines 49-56):
   - Validation error formatting
   - Config loading helpers (if any)

5. Add tests for deviceRoutes.ts:

   a. **POST /v1/auth/device/start**:
   - Successful device code request
   - Auth0 error response
   - Missing config

   b. **POST /v1/auth/device/poll**:
   - Authorization pending (retry needed)
   - Authorization complete (tokens returned)
   - Authorization expired
   - Authorization denied
   - Slow down response

6. Run coverage:

===
npm run test:coverage 2>&1 | grep -E "shared.ts|deviceRoutes.ts"
===

---

## Definition of Done

- [ ] shared.ts ≥ 90% line coverage
- [ ] deviceRoutes.ts ≥ 90% line coverage
- [ ] All device flow states tested
- [ ] Error paths explicitly tested
- [ ] `npm run ci` passes
- [ ] No flaky tests introduced

---

## Verification Commands

Check specific file coverage:
===
npm run test:coverage 2>&1 | grep -E "auth.*shared|deviceRoutes"
===

Run full CI:
===
npm run ci
===

---

## Rollback Plan

If Auth0 mock complexity is too high:
1. Focus on the most common paths (start, successful poll)
2. Document edge cases that need mock improvements
3. Consider using nock for HTTP-level mocking

