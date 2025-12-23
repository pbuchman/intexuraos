# 2-1 - Raise Coverage Thresholds to 90%

**Tier:** 2 (Depends on: ALL Tier 0, Tier 1, and 2-0 must be complete)

---

## Prerequisites

Before starting this issue, ensure ALL of these are complete:

**Tier 0:**

- [x] `0-0-narrow-coverage-exclusions.md` - Coverage exclusions narrowed
- [x] `0-1-common-package-coverage.md` - Common utilities tested
- [x] `0-2-standardize-test-utilities.md` - Test patterns documented

**Tier 1:**

- [x] `1-0-auth-service-token-routes.md` - Token routes ≥85%
- [x] `1-1-auth-service-device-routes.md` - Device routes ≥90%
- [x] `1-2-auth-service-shared-httpclient.md` - Shared utils ≥95%
- [x] `1-3-promptvault-usecases.md` - Use cases ≥85%
- [x] `1-4-whatsapp-webhook-usecase.md` - Webhook use case ≥80%
- [x] `1-5-whatsapp-routes.md` - Routes ≥85%
- [x] `1-6-whatsapp-config-signature.md` - Config ≥90%
- [x] `1-7-notion-service-coverage.md` - Notion service ≥90%
- [x] `1-8-server-initialization.md` - Servers ≥95%

**Tier 2:**

- [x] `2-0-infra-adapters-coverage.md` - Infra adapters ≥80%

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90% (currently temporarily lowered to 65%)
- Test runner: Vitest with v8 coverage provider
- Original thresholds: 89/85/90/89 (lines/branches/functions/statements)
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Config file: `vitest.config.ts`
- Current thresholds: 65/70/45/65

### Changes from Prior Tiers

- Coverage exclusions narrowed (0-0)
- Common package at 100% (0-1)
- Test patterns established (0-2)
- All route handlers tested (Tier 1)
- All use cases tested (Tier 1)
- All infra adapters tested (2-0)

---

## Problem Statement

Coverage thresholds were temporarily lowered during the domain colocation refactor. After all other coverage issues are resolved, thresholds must be restored.

This is the **final issue** to complete the coverage improvement project.

---

## Scope

### In Scope

- `vitest.config.ts` threshold configuration
- `.github/copilot-instructions.md` documentation
- Verification that all apps meet the target

### Out of Scope

- Writing new tests (should be done by now)
- Changing exclusions (done in 0-0)

---

## Required Approach

Verify all prior issues are complete before attempting this.

---

## Steps

1. Verify current coverage meets 90%:

===
npm run test:coverage
===

2. Check coverage summary output for:
   - Lines ≥ 89%
   - Branches ≥ 85%
   - Functions ≥ 90%
   - Statements ≥ 89%

3. If coverage is sufficient, update `vitest.config.ts`:

   Change:

   ```
   thresholds: {
     lines: 65,
     branches: 70,
     functions: 45,
     statements: 65,
   }
   ```

   To:

   ```
   thresholds: {
     lines: 89,
     branches: 85,
     functions: 90,
     statements: 89,
   }
   ```

4. Remove the "temporarily lowered" comments from vitest.config.ts

5. Update `.github/copilot-instructions.md`:
   - Change "65% lines, 70% branches, 45% functions, 65% statements (temporarily lowered)"
   - To "89% lines, 85% branches, 90% functions, 89% statements"
   - Remove the TODO about restoring thresholds

6. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] All coverage thresholds restored to 89/85/90/89
- [ ] Temporary comments removed from vitest.config.ts
- [ ] `.github/copilot-instructions.md` updated
- [ ] `npm run ci` passes with new thresholds

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If CI fails after raising thresholds:

1. Identify which app/package is below threshold from coverage output
2. Check if any Tier 1 or 2-0 issues were not fully completed
3. Either:
   - Fix the specific gap
   - Keep thresholds at an intermediate level that passes
