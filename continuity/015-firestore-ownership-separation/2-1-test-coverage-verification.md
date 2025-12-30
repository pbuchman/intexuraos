# 2-1: Test Coverage Verification

**Tier**: 2 (Dependent/Integrative)
**Dependencies**: 1-0, 1-1, 1-2, 2-0

## Context

Verify that all new code is properly tested and coverage thresholds are met. This is the mandatory second-to-last task before archival.

## Problem

Need to ensure:
1. New files have adequate test coverage
2. Modified files maintain coverage thresholds
3. All edge cases are tested
4. Integration tests pass

## Scope

**In Scope:**
- Run full test suite with coverage
- Verify new files meet coverage thresholds
- Identify and fill any coverage gaps
- Verify integration tests pass

**Out of Scope:**
- Modifying `vitest.config.ts` coverage exclusions (FORBIDDEN)
- Modifying coverage thresholds (FORBIDDEN)

## Approach

1. Run `npm run test:coverage` for affected services
2. Analyze coverage report
3. Write additional tests if needed
4. Re-run until thresholds met

## Steps

- [ ] Run coverage for notion-service
- [ ] Run coverage for promptvault-service
- [ ] Run coverage for infra-notion package
- [ ] Analyze coverage reports
- [ ] Identify uncovered lines/branches
- [ ] Write additional tests if coverage < threshold
- [ ] Re-run `npm run ci` to ensure all tests pass
- [ ] Verify no degradation in other services

## Definition of Done

- `npm run ci` passes in root
- Coverage thresholds met for all changed code
- All new files have tests
- All edge cases covered
- No coverage exclusions added (FORBIDDEN)

## Verification

```bash
# Full CI must pass
npm run ci

# Coverage for affected packages
npm run test:coverage --workspace=@intexuraos/infra-notion
cd apps/notion-service && npm run test:coverage
cd apps/promptvault-service && npm run test:coverage

# Verify thresholds met (should pass without errors)
npm run test:coverage 2>&1 | grep -E "ERROR|FAIL" && echo "Coverage check failed" || echo "Coverage OK"
```

## Rollback

N/A - only verification, no code changes

## Important Note

**ABSOLUTE RULE:** NEVER modify `vitest.config.ts` coverage exclusions or thresholds. If coverage fails, write tests to achieve coverage. This rule has NO exceptions.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
