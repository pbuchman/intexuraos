# Task 1-2: CI and Package.json Integration

**Tier:** 1 (Independent Deliverable)
**Dependencies:** 1-0-verification-scripts (scripts created)

## Context

Integrate new verification scripts into CI pipeline and make them runnable via npm scripts.

## Problem Statement

Need to:

1. Add npm scripts to package.json for each verification script
2. Update CI Phase 1 to run new verification scripts in parallel
3. Ensure scripts are discoverable and runnable

## Scope

**In Scope:**

- Add 6 new npm scripts to package.json
- Update scripts/ci.mjs Phase 1 command array
- Maintain existing CI structure

**Out of Scope:**

- Creating new CI phases
- Modifying existing scripts
- Running CI (testing task)

## Required Approach

Follow existing pattern:

1. Add scripts to package.json `scripts` section
2. Use pattern: `"verify:<name>": "node scripts/verify-<name>.mjs"`
3. Update ci.mjs Phase 1 commands array to include new verifications

## Step Checklist

- [ ] **Package.json updates:**
  - Add `"verify:test-isolation": "node scripts/verify-test-isolation.mjs"`
  - Add `"verify:vitest-config": "node scripts/verify-vitest-config.mjs"`
  - Add `"verify:endpoints": "node scripts/verify-required-endpoints.mjs"`
  - Add `"verify:hash-routing": "node scripts/verify-hash-routing.mjs"`
  - Add `"verify:terraform-secrets": "node scripts/verify-terraform-secrets.mjs"`
  - Add `"install-hooks": "node scripts/install-hooks.mjs"` (optional)

- [ ] **CI integration (scripts/ci.mjs):**
  - Read current Phase 1 commands array
  - Add 5 new commands to Phase 1 (Static Validation):
    - `'verify:test-isolation'`
    - `'verify:vitest-config'`
    - `'verify:endpoints'`
    - `'verify:hash-routing'`
    - `'verify:terraform-secrets'`
  - Maintain parallel: true for Phase 1
  - Keep existing commands in place

- [ ] Update CONTINUITY.md ledger with completion

## Definition of Done

- Package.json has 6 new npm scripts
- CI Phase 1 includes 5 new verification commands
- Phase 1 still runs in parallel
- Existing commands preserved
- Ledger updated with "Done" status

## Verification Commands

```bash
# Check npm scripts exist
npm run verify:test-isolation --help 2>&1 | grep -q "node scripts" && echo "✓ Script exists"
npm run verify:vitest-config --help 2>&1 | grep -q "node scripts" && echo "✓ Script exists"

# Check CI config
grep -A 10 "Static Validation" scripts/ci.mjs | grep -c "verify:"
# Expected: Count should be 9 (4 existing + 5 new)
```

## Rollback Plan

If integration fails:

1. Restore package.json: `git checkout package.json`
2. Restore ci.mjs: `git checkout scripts/ci.mjs`
3. Document failure in ledger
4. Fix errors and retry

---

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 2-0-testing.md without waiting for user input.
