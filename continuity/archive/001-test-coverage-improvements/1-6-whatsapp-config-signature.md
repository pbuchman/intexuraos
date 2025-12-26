# 1-6 - Add Tests for whatsapp-service Config and Signature

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

Current coverage:

- `apps/whatsapp-service/src/config.ts`: **70.96%** (lines 57-65 uncovered)
- `apps/whatsapp-service/src/signature.ts`: **91.3%** (lines 50-51 uncovered)

These files handle configuration loading and WhatsApp signature validation.

---

## Scope

### In Scope

- `apps/whatsapp-service/src/config.ts`
- `apps/whatsapp-service/src/signature.ts`

### Out of Scope

- Route handlers (covered by 1-5)
- Domain logic (covered by 1-4)

---

## Required Approach

- **Testing style**: Unit tests
- **Mocking strategy**:
  - Mock environment variables for config
  - Test signature validation with known test vectors
- **Architecture boundaries**: Test utility functions directly

---

## Steps

1. Read source files:

===
cat apps/whatsapp-service/src/config.ts
cat apps/whatsapp-service/src/signature.ts
===

2. Read existing tests:

===
cat apps/whatsapp-service/src/**tests**/config.test.ts
cat apps/whatsapp-service/src/**tests**/signature.test.ts
===

3. Identify uncovered scenarios:
   - config.ts lines 57-65: likely missing env var scenarios
   - signature.ts lines 50-51: likely edge case in validation

4. Add tests for:
   - Config loading with missing required vars
   - Config loading with invalid values
   - Signature edge cases (empty body, invalid hex)

5. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] `config.ts` coverage ≥ 90%
- [ ] `signature.ts` coverage ≥ 95%
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If env var mocking causes issues:

1. Use `vi.stubEnv()` or similar
2. Ensure cleanup in afterEach
