# 0-0 - Narrow Coverage Exclusions and Document Justifications

**Tier:** 0 (Independent - no dependencies)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90% (currently temporarily lowered to 65%)
- Test runner: Vitest with v8 coverage provider
- Architecture: Apps with colocated domain/infra, packages/common as shared utilities
- Import rules: apps import only from @praxos/common, no cross-app imports
- Mock external systems only (Auth0, Firestore, Notion)
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Config file: `vitest.config.ts`
- Provider: v8
- Current thresholds: 65/70/45/65 (lines/branches/functions/statements)
- Target thresholds: 89/85/90/89

---

## Problem Statement

The `vitest.config.ts` contains overly broad coverage exclusions that hide testable code:

Current exclusions to review:

1. `**/infra/**` - Excludes ALL infrastructure adapters (too broad)
2. `apps/web/**` - Excludes entire web app (needs E2E plan)
3. `**/notion.ts` - Excludes Notion client wrapper
4. `**/firestore.ts` - Excludes Firestore client wrapper
5. `apps/api-docs-hub/**` - Excludes entire aggregator service
6. `**/whatsappClient.ts` - Excludes WhatsApp client
7. `**/adapters.ts` - Excludes adapters file
8. `**/domain/**/models/**` - Type-only files (justified)
9. `**/domain/**/ports/**` - Interface-only files (justified)

**Unjustified exclusions** that need tests or narrower patterns:

- `**/infra/**` should be narrowed to exclude only external SDK calls
- `**/notion.ts` and `**/firestore.ts` in common should have unit tests for their logic
- `apps/api-docs-hub/**` has config logic that should be tested

---

## Scope

### In Scope

- `vitest.config.ts` - coverage exclude patterns
- Analysis of what each exclusion pattern actually matches

### Out of Scope

- Writing actual tests (Tier 1 issues will handle that)
- Changing test runner or provider

---

## Required Approach

1. Analyze each exclusion pattern
2. Categorize as:
   - **Justified**: Type-only files, pure SDK wrappers with no logic
   - **Unjustified**: Files with testable logic
3. For unjustified exclusions:
   - Either narrow the pattern
   - Or document that a specific Tier 1 issue will add tests

---

## Steps

1. Read `vitest.config.ts` to understand current exclusions:

===
cat vitest.config.ts
===

2. For each exclusion pattern, list the files it matches:

===
find apps packages -type f -name "\*.ts" | grep -E "infra" | head -20
===

3. Review each matched file to determine if it has testable logic

4. Create a table documenting each exclusion with justification status

5. Update `vitest.config.ts` to:
   - Keep justified exclusions with clear comments
   - Remove or narrow unjustified exclusions
   - Add TODO comments referencing specific Tier 1 issues that will add tests

6. Update thresholds comment to reference this analysis

7. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] Each coverage exclusion has documented justification in vitest.config.ts comments
- [ ] Unjustified broad exclusions are narrowed or removed
- [ ] Thresholds remain at current levels (Tier 1 issues will raise them)
- [ ] `npm run ci` passes
- [ ] Comments in vitest.config.ts explain each exclusion and reference follow-up issues

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If coverage breaks after narrowing exclusions:

1. Revert `vitest.config.ts` changes
2. Create more specific issues for each problematic exclusion
