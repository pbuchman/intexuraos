# 0-1 - Add Unit Tests for packages/common Utilities

**Tier:** 0 (Independent - no dependencies)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90%
- Test runner: Vitest with v8 coverage provider
- `packages/common` imports nothing (leaf package)
- Mock external systems only
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Config file: `vitest.config.ts`
- Test location: `packages/common/src/__tests__/`

---

## Problem Statement

Current coverage for `packages/common`:

- `redaction.ts`: 100% ✓
- `result.ts`: 100% ✓
- `auth/fastifyAuthPlugin.ts`: 97.64% (lines 86-87 uncovered)
- `auth/jwt.ts`: 92.45% (lines 80-81, 87-88 uncovered)
- `http/*`: 100% ✓

Excluded but potentially testable:

- `firestore.ts` - Firestore client wrapper (excluded via `**/firestore.ts`)
- `notion.ts` - Notion client wrapper (excluded via `**/notion.ts`)

These files are excluded from coverage but may contain testable utility logic beyond pure SDK initialization.

---

## Scope

### In Scope

- `packages/common/src/firestore.ts`
- `packages/common/src/notion.ts`
- `packages/common/src/auth/jwt.ts` (raise from 92% to 95%+)
- `packages/common/src/auth/fastifyAuthPlugin.ts` (raise from 97% to 100%)

### Out of Scope

- App-specific code
- Files already at 100% coverage

---

## Required Approach

- **Testing style**: Unit tests only
- **Mocking strategy**: Mock SDK clients (Firestore, Notion Client)
- **Architecture boundaries**: Test only exported utilities, not internal SDK behavior

---

## Steps

1. Read existing test files to understand patterns:

===
cat packages/common/src/**tests**/jwt.test.ts
cat packages/common/src/**tests**/fastifyAuthPlugin.test.ts
===

2. Read source files to identify testable logic:

===
cat packages/common/src/firestore.ts
cat packages/common/src/notion.ts
===

3. Identify untested branches in jwt.ts and fastifyAuthPlugin.ts:
   - Lines 80-81, 87-88 in jwt.ts
   - Lines 86-87 in fastifyAuthPlugin.ts

4. Create or extend test files:
   - Add edge case tests for jwt.ts
   - Add edge case tests for fastifyAuthPlugin.ts
   - If firestore.ts or notion.ts have utility functions, add tests

5. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] `packages/common/src/auth/jwt.ts` coverage ≥ 95%
- [ ] `packages/common/src/auth/fastifyAuthPlugin.ts` coverage = 100%
- [ ] Any testable logic in firestore.ts/notion.ts has tests
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If tests are flaky:

1. Mark flaky tests with `.skip` and document reason
2. Create follow-up issue to fix flakiness
