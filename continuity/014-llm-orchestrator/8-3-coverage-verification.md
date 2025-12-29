# 8-3: Coverage Verification

**Tier:** 8 - Integration & Testing
**Status:** Pending

## Context

**MANDATORY**: Verify test coverage meets thresholds before archival.

## Problem Statement

All code must be tested. Coverage verification is required before completion.

## Scope

**In Scope:**
- Run npm run ci
- Verify coverage thresholds
- Fix any coverage gaps

**Out of Scope:**
- Terraform validation (8-4)

## Required Approach

1. Run full CI suite
2. Check coverage report
3. Add tests for any uncovered code
4. Do NOT proceed if coverage fails

## Step Checklist

- [ ] Run `npm run ci`
- [ ] Check coverage report for llm-orchestrator-service
- [ ] Check coverage report for user-service (modified)
- [ ] Check coverage for new packages
- [ ] Fix any coverage gaps
- [ ] Re-run until passing

## Definition of Done

- [ ] `npm run ci` passes
- [ ] All coverage thresholds met
- [ ] No ESLint warnings
- [ ] No TypeScript errors

## Verification Commands

```bash
npm run ci
npm run test:coverage
```

## Rollback Plan

If coverage cannot be achieved, document gaps and create follow-up issues.
