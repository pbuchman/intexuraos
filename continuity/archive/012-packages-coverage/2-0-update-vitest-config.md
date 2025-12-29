# Task 2-0: Update vitest.config.ts Coverage Exclusions

## Tier

2 - Dependent on Tier 1 completion

## Context

Current vitest.config.ts excludes decomposed packages from coverage:

```javascript
// Decomposed packages (covered via packages/common facade)
// JUSTIFIED: These packages contain the original code that was extracted from
// packages/common. The facade package re-exports everything, so tests validate
// behavior through the facade. No code duplication exists.
'packages/common-core/**',
'packages/common-http/**',
'packages/infra-firestore/**',
'packages/infra-notion/**',
```

This justification is outdated - packages/common was removed completely.

## Problem Statement

Remove exclusions for decomposed packages since they now have their own tests.

## Scope

- vitest.config.ts coverage.exclude section

## Non-Scope

- Other exclusions (remain justified)

## Required Approach

1. Remove the 4 exclusions for decomposed packages
2. Update comment to reflect current state
3. Verify coverage passes with updated config

## Step Checklist

- [ ] Remove packages/common-core/\*\* exclusion
- [ ] Remove packages/common-http/\*\* exclusion
- [ ] Remove packages/infra-firestore/\*\* exclusion
- [ ] Remove packages/infra-notion/\*\* exclusion
- [ ] Update/remove outdated comment
- [ ] Run npm run ci and verify passes

## Definition of Done

All packages are included in coverage and thresholds pass

## Verification Commands

```bash
npm run ci
```

## Rollback Plan

Re-add exclusions if coverage thresholds fail
