# 1-4 - Notion Service Shared Coverage (20% → 85%)

**Tier:** 1 (Depends on: 0-0-review-exclusions.md, 0-1-test-utility-improvements.md)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90/85/85/90 (lines/branches/functions/statements)
- Test runner: Vitest with v8 coverage provider
- Architecture: Routes in `src/routes/v1/`, shared utilities in `shared.ts`
- Mock external systems only
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Current coverage:
  - notion-service shared.ts: 20% (lines 9-16 uncovered)

---

## Problem Statement

`apps/notion-service/src/routes/v1/shared.ts` has only 20% line coverage. This file likely contains validation helpers or shared route utilities that are used across notion-service routes.

Uncovered lines: 9-16

---

## Scope

### In Scope

- `apps/notion-service/src/routes/v1/shared.ts`
- Understanding and testing shared utilities
- Creating/extending test coverage

### Out of Scope

- Route integration tests
- Actual Notion API calls
- Changes to shared utility logic

---

## Required Approach

- **Unit tests** - Test shared functions directly if possible
- **Integration tests** - If utilities are only used within routes, test via route injection
- **Mock strategy**:
  - Minimal mocking needed for utility functions
  - Use Fastify injection if testing via routes

---

## Steps

1. Read the source file to understand what's being exported:

===
cat apps/notion-service/src/routes/v1/shared.ts
===

2. Identify what's on lines 9-16 (the uncovered code)

3. Determine how the shared utilities are used:

===
grep -r "from.\*shared" apps/notion-service/src/routes/
===

4. Read existing tests to see if shared.ts is indirectly tested:

===
cat apps/notion-service/src/**tests**/\*.test.ts
===

5. Create test coverage:

   a. If shared.ts exports validation helpers:
   - Test with valid input
   - Test with invalid input (each validation rule)

   b. If shared.ts exports error formatters:
   - Test error message formatting
   - Test error code mapping

   c. If shared.ts exports request utilities:
   - Test through route integration tests

6. Run coverage:

===
npm run test:coverage 2>&1 | grep "shared.ts"
===

---

## Definition of Done

- [ ] notion-service shared.ts ≥ 85% line coverage
- [ ] All exported functions have test coverage
- [ ] `npm run ci` passes
- [ ] No flaky tests introduced

---

## Verification Commands

# Check specific file coverage:

# npm run test:coverage 2>&1 | grep "notion.\*shared.ts"

# Run full CI:

# npm run ci

---

## Rollback Plan

If shared.ts contains only simple re-exports:

1. Consider if 85% coverage is achievable
2. Document why certain lines can't be covered
3. Potentially mark justified exclusion in vitest.config.ts
