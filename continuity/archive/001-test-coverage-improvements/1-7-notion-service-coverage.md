# 1-7 - Add Tests for notion-service Routes and Services

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
- Mock external systems only (Notion, Firestore)
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Test location: `apps/notion-service/src/__tests__/`

### Changes from Tier 0

- Coverage exclusions have been narrowed (see 0-0)
- Test utility patterns documented (see 0-2)
- Fakes patterns reviewed (see 0-2)

---

## Problem Statement

Current coverage for notion-service:

- `services.ts`: **77.77%** (lines 83-98, 124-125 uncovered)
- `routes/v1/shared.ts`: **20%** (lines 9-16 uncovered)
- `routes/v1/integrationRoutes.ts`: **91.26%** (lines 185-186, 251-252 uncovered)

The services.ts file handles service initialization and has gaps. The shared.ts file has very low coverage.

---

## Scope

### In Scope

- `apps/notion-service/src/services.ts`
- `apps/notion-service/src/routes/v1/shared.ts`
- `apps/notion-service/src/routes/v1/integrationRoutes.ts`

### Out of Scope

- Infra adapters (Tier 2 issue)
- Webhook routes (already 96% covered)

---

## Required Approach

- **Testing style**: Integration tests using Fastify injection
- **Mocking strategy**:
  - Mock Notion API client
  - Mock Firestore connection repository
  - Use existing fakes (reviewed in 0-2)
- **Architecture boundaries**: Test through HTTP and service initialization

---

## Steps

1. Read source files:

===
cat apps/notion-service/src/services.ts
cat apps/notion-service/src/routes/v1/shared.ts
===

2. Read existing tests:

===
cat apps/notion-service/src/**tests**/integrationRoutes.test.ts
cat apps/notion-service/src/**tests**/fakes.ts
===

3. Identify uncovered scenarios:
   - services.ts: Service initialization errors, missing dependencies
   - shared.ts: Utility function edge cases
   - integrationRoutes.ts: Specific error conditions

4. Add tests for:
   - Service initialization with missing config
   - Service initialization with invalid Notion token
   - Shared utility error handling
   - Integration route edge cases

5. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] `services.ts` coverage ≥ 90%
- [ ] `shared.ts` coverage ≥ 80%
- [ ] `integrationRoutes.ts` coverage ≥ 95%
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If service initialization tests are complex:

1. Focus on routes first
2. Add service tests as follow-up
