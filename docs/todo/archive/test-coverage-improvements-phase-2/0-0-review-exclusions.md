# 0-0 - Review Coverage Exclusions for 90% Target

**Tier:** 0 (Independent - no dependencies)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: Currently 80/72/65/80, goal is 90/85/85/90
- Test runner: Vitest with v8 coverage provider
- Architecture: Apps in `apps/*`, shared utilities in `packages/common`
- Import rules: apps can only import from `@praxos/common`
- Colocated infra (`src/infra/**`) tested via integration tests through routes
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Config file: `vitest.config.ts`
- Test command: `npm run test:coverage`
- Coverage provider: v8

---

## Problem Statement

To achieve 90% coverage, we need to review the current exclusion patterns in `vitest.config.ts` and determine if any can be narrowed or removed. Some exclusions may have been overly broad.

Current exclusions to review:

1. `**/infra/**` - Entire infra directories excluded (JUSTIFIED as thin SDK wrappers)
2. `**/domain/**/models/**` - Type-only files (JUSTIFIED)
3. `**/domain/**/ports/**` - Interface definitions (JUSTIFIED)
4. `apps/web/**` - React frontend (JUSTIFIED - needs E2E)
5. `apps/api-docs-hub/**` - Static aggregator (JUSTIFIED)
6. `**/notion.ts`, `**/firestore.ts` - SDK wrappers (Review needed)
7. `**/whatsappClient.ts`, `**/adapters.ts` - SDK wrappers (Review needed)
8. `**/index.ts` - Barrel files (JUSTIFIED)

---

## Scope

### In Scope

- `vitest.config.ts` exclusion patterns
- Evaluating if any SDK wrapper files have testable logic

### Out of Scope

- Writing new tests (that's Tier 1)
- Changing architecture patterns
- Modifying infra adapters

---

## Required Approach

- **Analysis only** - Do not write tests in this issue
- Document findings for Tier 1 issues
- Update exclusion comments with clear justifications

---

## Steps

1. Read `vitest.config.ts` and document all exclusion patterns:

===
cat vitest.config.ts
===

2. For each SDK wrapper exclusion (`notion.ts`, `firestore.ts`, `whatsappClient.ts`, `adapters.ts`):
   - Read the file content
   - Determine if there's logic beyond pure SDK delegation
   - If there's logic, note it for Tier 1 testing

3. Review if `**/infra/**` exclusion can be narrowed to specific files rather than entire directories

4. Update `vitest.config.ts` exclusion comments to clearly state:
   - JUSTIFIED: Why it's excluded and will remain excluded
   - REVIEW: If it could potentially have tests added

5. Document findings in this issue file by updating the Definition of Done section

---

## Definition of Done

- [ ] All exclusion patterns reviewed
- [ ] Each exclusion has clear justification comment in `vitest.config.ts`
- [ ] Any SDK wrappers with testable logic identified for Tier 1
- [ ] `npm run ci` passes
- [ ] No new exclusions added

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If changes to exclusions break coverage thresholds:

1. Revert `vitest.config.ts` to previous state
2. Document why the exclusion was necessary
