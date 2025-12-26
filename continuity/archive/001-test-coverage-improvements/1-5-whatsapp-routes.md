# 1-5 - Add Tests for whatsapp-service Routes

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
- Test location: `apps/whatsapp-service/src/__tests__/`

### Changes from Tier 0

- Coverage exclusions have been narrowed (see 0-0)
- Test utility patterns documented (see 0-2)

---

## Problem Statement

Current coverage for whatsapp-service routes:

- `mappingRoutes.ts`: **76.89%** (lines 114-227, 285-301 uncovered)
- `webhookRoutes.ts`: **72.37%** (lines 93-297, 303-333 uncovered)
- `shared.ts`: **66.66%** (lines 50-51, 100-136 uncovered)

These route files handle WhatsApp user mapping and webhook processing.

---

## Scope

### In Scope

- `apps/whatsapp-service/src/routes/v1/mappingRoutes.ts`
- `apps/whatsapp-service/src/routes/v1/webhookRoutes.ts`
- `apps/whatsapp-service/src/routes/v1/shared.ts`

### Out of Scope

- Domain use cases (covered by 1-4)
- Infra adapters (Tier 2 issue)

---

## Required Approach

- **Testing style**: Integration tests using Fastify injection
- **Mocking strategy**:
  - Mock Firestore repositories
  - Mock Notion repository
  - Mock WhatsApp signature validation
  - Use existing fakes (reviewed in 0-2)
- **Architecture boundaries**: Test through HTTP layer

---

## Steps

1. Read route files:

===
cat apps/whatsapp-service/src/routes/v1/mappingRoutes.ts
cat apps/whatsapp-service/src/routes/v1/webhookRoutes.ts
===

2. Read existing tests:

===
cat apps/whatsapp-service/src/**tests**/webhookReceiver.test.ts
cat apps/whatsapp-service/src/**tests**/webhookVerification.test.ts
===

3. Identify missing test cases:
   - mappingRoutes: POST /whatsapp/connect, GET /whatsapp/status, DELETE /whatsapp/disconnect
   - webhookRoutes: Various message types, error scenarios
   - shared: Utility functions

4. Extend test files or create new ones:
   - `apps/whatsapp-service/src/__tests__/mappingRoutes.test.ts`

5. Add tests for:
   - Connect flow (success, already connected, invalid data)
   - Status check (connected, not connected)
   - Disconnect flow (success, not connected)
   - Webhook message routing

6. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] `mappingRoutes.ts` coverage ≥ 90%
- [ ] `webhookRoutes.ts` coverage ≥ 85%
- [ ] `shared.ts` coverage ≥ 90%
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If JWT auth mocking is complex:

1. Use existing testUtils.ts patterns for JWT creation
2. Reference auth-service tests for JWT patterns
