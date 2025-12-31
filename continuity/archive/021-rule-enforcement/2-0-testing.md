# Task 2-0: Testing All Enforcement

**Tier:** 2 (Dependent/Integrative)
**Dependencies:** 1-0, 1-1, 1-2 (scripts created, ESLint updated, CI integrated)

## Context

Test all new enforcement mechanisms individually and as part of full CI pipeline to ensure they work correctly.

## Problem Statement

Need to verify:

1. Each verification script runs successfully
2. ESLint rules are active and enforceable
3. Full CI pipeline passes with new enforcement
4. No false positives detected
5. Error messages are helpful and actionable

## Scope

**In Scope:**

- Run each verification script individually
- Run `npm run lint` with new rules
- Run full `npm run ci` pipeline
- Validate all pass with current codebase
- Test error messages (optional: introduce violations)

**Out of Scope:**

- Fixing application code (codebase is compliant)
- Modifying enforcement mechanisms
- Performance tuning

## Required Approach

Test incrementally:

1. Individual verification scripts first
2. Then ESLint
3. Finally full CI pipeline
4. Document any issues in ledger

## Step Checklist

- [ ] **Test verification scripts individually:**
  - Run `npm run verify:test-isolation`
  - Run `npm run verify:vitest-config`
  - Run `npm run verify:endpoints`
  - Run `npm run verify:hash-routing`
  - Run `npm run verify:terraform-secrets`
  - Confirm all exit with code 0 and show ✓ messages

- [ ] **Test ESLint rules:**
  - Run `npm run lint`
  - Confirm 0 warnings, 0 errors
  - Verify new rules are active (check config with --print-config)

- [ ] **Test full CI pipeline:**
  - Run `npm run ci`
  - Watch Phase 1 run new verifications in parallel
  - Confirm all phases pass
  - Note total execution time (should remain fast)

- [ ] **Optional: Test error messages:**
  - Introduce a test violation (e.g., add inline style to web component)
  - Run appropriate verification
  - Confirm error message is helpful
  - Revert violation

- [ ] **Format code with Prettier:**
  - Run `npx prettier --write .`
  - Ensure all new scripts are formatted

- [ ] Update CONTINUITY.md with test results

## Definition of Done

- All 5 verification scripts pass individually
- `npm run lint` passes with 0 warnings
- `npm run ci` passes completely
- Error messages tested (at least 1 rule)
- Code formatted with Prettier
- Ledger updated with test results

## Verification Commands

```bash
# Individual script tests
npm run verify:test-isolation
npm run verify:vitest-config
npm run verify:endpoints
npm run verify:hash-routing
npm run verify:terraform-secrets

# ESLint test
npm run lint

# Full CI test
npm run ci

# Format check
npx prettier --check .
```

Expected: All commands exit with code 0

## Rollback Plan

If tests fail:

1. Document failures in ledger with details
2. Investigate root cause (false positive vs real issue)
3. Fix enforcement mechanism or document exception
4. Retest before proceeding

---

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 2-1-coverage-verification.md without waiting for user input.
