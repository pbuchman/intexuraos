# 0-1 - Test Utility Improvements

**Tier:** 0 (Independent - no dependencies)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90/85/85/90 (lines/branches/functions/statements)
- Test runner: Vitest with v8 coverage provider
- Architecture: Apps in `apps/*`, shared utilities in `packages/common`
- Mock external systems only (Auth0, Firestore, Notion)
- Assert observable behavior, not implementation
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Test file pattern: `**/*.test.ts`, `**/*.spec.ts`
- Each app has `src/__tests__/` directory with `fakes.ts` and `testUtils.ts`

---

## Problem Statement

To achieve 90% coverage efficiently, we need robust shared test utilities. The current test utilities in each app's `__tests__` folder have varying patterns:

Current test utility files:
- `apps/auth-service/src/__tests__/` - uses testUtils for JWT/JWKS mocking
- `apps/notion-service/src/__tests__/fakes.ts` - 73.38% covered
- `apps/promptvault-service/src/__tests__/fakes.ts` - 71.19% covered
- `apps/whatsapp-service/src/__tests__/fakes.ts` - 48.57% covered

The whatsapp-service fakes have particularly low coverage (48.57%), indicating unused fake implementations that could be cleaned up or utilized.

---

## Scope

### In Scope

- Review and standardize test utility patterns across apps
- Identify unused fake implementations
- Ensure consistent mocking strategies
- Document common patterns for Tier 1 work

### Out of Scope

- Writing new feature tests (that's Tier 1)
- Changing production code
- Adding new external dependencies

---

## Required Approach

- **Pattern standardization** - Document best practices for test utilities
- **Fake audit** - Identify which fake methods are unused
- **Cleanup unused code** - Remove dead fake implementations

---

## Steps

1. Read each app's test utility files:

===
cat apps/auth-service/src/__tests__/testUtils.ts
cat apps/notion-service/src/__tests__/fakes.ts
cat apps/notion-service/src/__tests__/testUtils.ts
cat apps/promptvault-service/src/__tests__/fakes.ts
cat apps/promptvault-service/src/__tests__/testUtils.ts
cat apps/whatsapp-service/src/__tests__/fakes.ts
cat apps/whatsapp-service/src/__tests__/testUtils.ts
===

2. Identify common patterns used across apps:
   - JWT token generation
   - JWKS server mocking
   - Repository fakes
   - Fastify app setup

3. For each fake file, check which methods are actually called in tests:

===
grep -r "FakeNotionConnectionRepository\|FakePromptRepository\|FakeWhatsAppWebhookEventRepository" apps/*/src/__tests__/*.test.ts
===

4. Remove unused fake methods or document why they're needed for upcoming tests

5. Ensure all fake files follow a consistent pattern:
   - Clear method signatures
   - Return types matching real implementations
   - In-memory storage for state

6. Update any fakes that don't properly implement the interface they're faking

---

## Definition of Done

- [ ] All test utility files reviewed
- [ ] Unused fake methods identified and documented
- [ ] Any cleanup changes made to fakes.ts files
- [ ] Coverage of fakes.ts files improved or stable (not decreased)
- [ ] `npm run ci` passes
- [ ] Pattern documentation added as comments in testUtils.ts files

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

Check fake coverage specifically:
===
npm run test:coverage 2>&1 | grep "fakes.ts"
===

---

## Rollback Plan

If cleanup breaks tests:
1. Revert changes to fakes.ts files
2. Keep unused methods but add `// Used by upcoming tests` comment

