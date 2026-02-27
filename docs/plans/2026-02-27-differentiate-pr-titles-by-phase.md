# Differentiate Orchestrator PR Titles by Phase

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "PR Title Format" instruction to the planning and execution agent prompts so agents know exactly how to title their pull requests depending on which phase they are in.

**Architecture:** The orchestrator's `system-prompt.ts` builds the system prompt for each agent type. We add a `### PR Title Format` section next to the existing `### PR Description Format` section in both `buildPlanningPrompt` and `buildExecutionPrompt`. No new files, no new types — pure string additions plus matching tests.

**Tech Stack:** TypeScript, Vitest (TDD).

---

## Context

File to modify: `workers/orchestrator/src/services/system-prompt.ts`
Test file: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

**Required change summary:**

| Prompt function          | PR Title Format to document                     |
| ------------------------ | ----------------------------------------------- |
| `buildPlanningPrompt`    | `[INT-XXX] [plan] <title>`                      |
| `buildExecutionPrompt`   | `[INT-XXX] <title>`                             |

The `buildPullRequestPrompt` and `buildPRReviewOverlay` are NOT touched — they handle already-open PRs, not new ones.

---

## Task 1: Write Failing Tests

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

**Step 1: Add two new test cases — run them to confirm they FAIL**

Add the following test cases inside the existing `describe('system-prompt', ...)` block:

```typescript
it('includes PR Title Format in planning prompt with [plan] tag', () => {
  const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['bug'] });

  expect(result).toContain('### PR Title Format');
  expect(result).toContain('[INT-XXX] [plan] <title>');
});

it('includes PR Title Format in execution prompt without [plan] tag', () => {
  const result = buildSystemPrompt({ ...baseParams, linearIssueLabels: ['code-task'] });

  expect(result).toContain('### PR Title Format');
  expect(result).toContain('[INT-XXX] <title>');
});
```

**Step 2: Run tests to confirm they fail**

```bash
cd /repo && pnpm --filter orchestrator run test -- --reporter=verbose 2>&1 | grep -A3 "PR Title Format"
```

Expected: two test failures mentioning "PR Title Format".

**Step 3: Commit the failing tests**

```bash
git add workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "test(orchestrator): add failing tests for PR title format by phase"
```

---

## Task 2: Implement — Add PR Title Format to Planning Prompt

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (function `buildPlanningPrompt`, around line 48)

**Step 1: Add the `### PR Title Format` section inside `buildPlanningPrompt`**

Locate the `### PR Description Format` section:

```
### PR Description Format
- Linear: [${linearIssueId ?? 'INT-XXX'}...
```

Insert a new `### PR Title Format` section **before** `### PR Description Format`:

```typescript
### PR Title Format
\`[${linearIssueId ?? 'INT-XXX'}] [plan] <title>\`

### PR Description Format
```

The full surrounding context in the template string should look like:

```
### PR Title Format
\`[${linearIssueId ?? 'INT-XXX'}] [plan] <title>\`

### PR Description Format
- Linear: [${linearIssueId ?? 'INT-XXX'}...
```

**Step 2: Run the planning test to confirm it passes**

```bash
cd /repo && pnpm --filter orchestrator run test -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|PR Title Format)"
```

Expected: the planning PR title format test now passes.

---

## Task 3: Implement — Add PR Title Format to Execution Prompt

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts` (function `buildExecutionPrompt`, around line 138)

**Step 1: Add the `### PR Title Format` section inside `buildExecutionPrompt`**

Locate the `### PR Description Format` section inside `buildExecutionPrompt`:

```
### PR Description Format
- Linear: [${linearIssueId ?? 'INT-XXX'}...
```

Insert a new `### PR Title Format` section **before** `### PR Description Format`:

```typescript
### PR Title Format
\`[${linearIssueId ?? 'INT-XXX'}] <title>\`

### PR Description Format
```

**Step 2: Run all system-prompt tests to confirm both new tests pass**

```bash
cd /repo && pnpm --filter orchestrator run test -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|PR Title)"
```

Expected: both new tests pass, zero regressions.

---

## Task 4: Verify & Commit

**Step 1: Run full workspace verification**

```bash
cd /repo && pnpm run verify:workspace:tracked -- orchestrator
```

Expected: TypeCheck ✓, Lint ✓, Tests ✓, Coverage ≥ 95%.

**Step 2: Run full CI**

```bash
cd /repo && pnpm run ci:tracked
```

Expected: all checks pass.

**Step 3: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts \
        workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat(orchestrator): add PR title format guidance for planning and execution agents

Planning PRs must be titled: [INT-XXX] [plan] <title>
Execution PRs must be titled: [INT-XXX] <title>

INT-661"
```

---

## Endpoint Changes

_No HTTP endpoints are added, modified, or removed by this change._

| Service        | Method   | Path   | Change      |
| -------------- | -------- | ------ | ----------- |
| orchestrator   | —        | —      | No change   |
