# Task 2-1: Coverage Verification and Archival

**Tier:** 2 (Final Task Before Archival)
**Dependencies:** 2-0-testing (all enforcement tested and passing)

## Context

Final verification step before archival: ensure test coverage remains at 95%+ and prepare for archival.

## Problem Statement

Need to confirm:

1. No coverage regressions introduced
2. All enforcement mechanisms are in place
3. Documentation is complete
4. Ready for archival

## Scope

**In Scope:**

- Run `npm run test:coverage`
- Verify coverage thresholds met (95%+)
- Final CONTINUITY.md ledger update
- Archive to continuity/archive/021-rule-enforcement/

**Out of Scope:**

- Writing new tests (no code changes made)
- Modifying coverage thresholds
- Fixing coverage issues (none expected)

## Required Approach

1. Run coverage check
2. Verify all thresholds pass
3. Update ledger with final status
4. Archive the task folder
5. Celebrate completion (play Chicken Banana!)

## Step Checklist

- [ ] **Run coverage verification:**
  - Execute `npm run test:coverage`
  - Confirm all thresholds ≥ 95% (lines, branches, functions, statements)
  - No new uncovered code introduced

- [ ] **Final ledger update:**
  - Mark all tasks as "Done" in CONTINUITY.md
  - Document final state: "All enforcement mechanisms active"
  - Clear "Open Questions" section
  - Note coverage verification passed

- [ ] **Verify deliverables:**
  - 7 ESLint rules added (eslint.config.js modified)
  - 6 verification scripts created (scripts/ directory)
  - CI integration updated (scripts/ci.mjs modified)
  - Package.json updated (6 new npm scripts)
  - All tests pass
  - Code formatted

- [ ] **Archive the task:**
  - Create `continuity/archive/021-rule-enforcement/`
  - Move entire `continuity/021-rule-enforcement/` folder to archive
  - Verify archive contains: INSTRUCTIONS.md, CONTINUITY.md, all task files

- [ ] **Celebration:**
  - Play Spotify track "Chicken Banana" by "Crazy Music Channel"

## Definition of Done

- Coverage at 95%+ for all metrics
- Ledger shows all tasks completed
- No open questions remain
- Task folder archived to continuity/archive/021-rule-enforcement/
- Celebration complete

## Verification Commands

```bash
# Coverage check
npm run test:coverage
# Expected: ✓ lines 95%+, branches 95%+, functions 95%+, statements 95%+

# Verify deliverables
git status | grep modified
# Expected: eslint.config.js, scripts/ci.mjs, package.json

git status | grep "scripts/verify-"
# Expected: 5 new verification scripts

# Archive structure
ls -la continuity/archive/021-rule-enforcement/
# Expected: INSTRUCTIONS.md, CONTINUITY.md, 0-0-setup.md, 1-*.md, 2-*.md
```

## Rollback Plan

If coverage fails:

1. Investigate which coverage decreased
2. Document in ledger
3. Do NOT archive until coverage passes
4. Write tests if needed (unlikely - no code changes made)

---

**Note:** This is the FINAL task. No continuation directive. Task is complete after successful archival.
