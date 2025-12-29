# Task 8-2: Coverage Verification

**Tier:** 8 (Second-to-last task before archival)

---

## Context Snapshot

- All tests created (8-0, 8-1)
- Need to verify coverage meets thresholds
- This is MANDATORY before archival

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Verify that test coverage meets the project thresholds:

- Lines: 90%
- Branches: 80%
- Functions: 90%
- Statements: 90%

---

## Scope

**In scope:**

- Run coverage report
- Identify any gaps
- Create additional tests if needed
- Verify all thresholds met

**Non-scope:**

- Changing coverage thresholds (protected file)

---

## Required Approach

### Step 1: Run coverage

```bash
npm run test:coverage
```

### Step 2: Review coverage report

Check the coverage for:

- `apps/llm-orchestrator-service/src/domain/**`
- `apps/llm-orchestrator-service/src/routes/**`
- `apps/llm-orchestrator-service/src/infra/**`

### Step 3: Identify gaps

Common gaps to check:

- Error handling branches
- Edge cases in usecases
- Repository error paths

### Step 4: Add missing tests

If coverage is below threshold:

1. Identify uncovered lines
2. Add targeted tests
3. Re-run coverage

### Step 5: Verify final coverage

```bash
npm run test:coverage 2>&1 | grep -A10 "llm-orchestrator-service"
```

---

## Step Checklist

- [ ] Run `npm run test:coverage`
- [ ] Review coverage report
- [ ] Identify any gaps below thresholds
- [ ] Add tests for uncovered code
- [ ] Re-run coverage verification
- [ ] All thresholds met

---

## Definition of Done

1. Coverage report generated
2. All thresholds met:
   - Lines ≥ 90%
   - Branches ≥ 80%
   - Functions ≥ 90%
   - Statements ≥ 90%
3. `npm run ci` passes

---

## Verification Commands

```bash
npm run test:coverage
npm run ci
```

---

## Rollback Plan

If thresholds not met:

1. Add more tests
2. Re-verify
3. Do NOT modify vitest.config.ts thresholds without permission

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
