# 0-2 - Standardize Test Utilities Across Apps

**Tier:** 0 (Independent - no dependencies)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90%
- Test runner: Vitest with v8 coverage provider
- Each app has its own `src/__tests__/` folder with fakes.ts and testUtils.ts
- Mock external systems only (Auth0, Firestore, Notion)
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Test locations: `apps/*/src/__tests__/`

---

## Problem Statement

Each app has its own test utilities but patterns are inconsistent:

- `apps/user-service/src/__tests__/` - No fakes.ts (uses inline mocks)
- `apps/promptvault-service/src/__tests__/fakes.ts` - 71.19% coverage
- `apps/notion-service/src/__tests__/fakes.ts` - 73.38% coverage
- `apps/whatsapp-service/src/__tests__/fakes.ts` - 48.57% coverage

Low fake coverage indicates many fake methods are never exercised in tests.

---

## Scope

### In Scope

- `apps/*/src/__tests__/fakes.ts` - Review and document patterns
- `apps/*/src/__tests__/testUtils.ts` - Review and document patterns
- Ensure consistent patterns across apps

### Out of Scope

- Writing new route tests (Tier 1 issues)
- Changing test infrastructure

---

## Required Approach

- **Testing style**: Review and document existing patterns
- **Mocking strategy**: Identify which fakes are actually used
- **Architecture boundaries**: Each app owns its own fakes

---

## Steps

1. Read all test utility files:

===
cat apps/promptvault-service/src/**tests**/fakes.ts
cat apps/promptvault-service/src/**tests**/testUtils.ts
cat apps/notion-service/src/**tests**/fakes.ts
cat apps/whatsapp-service/src/**tests**/fakes.ts
===

2. Identify common patterns:
   - JWT token generation
   - Fastify app creation
   - Mock repository patterns

3. Document which fake methods are unused (0% coverage)

4. Either:
   - Remove unused fake methods, OR
   - Document they are needed for Tier 1 tests

5. Ensure each app's testUtils.ts follows similar patterns

6. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] Unused fake methods identified and either removed or documented for Tier 1
- [ ] Test utility patterns documented
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If removing fake methods breaks tests:

1. Revert the removal
2. Add the missing test that uses the fake method
