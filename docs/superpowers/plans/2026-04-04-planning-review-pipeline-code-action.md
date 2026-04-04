# Planning���Review Pipeline: Show Code Action Instead of Merge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the code tasks list to show a "Code" button (not "Merge") when a planning task's review completes, so the user can trigger execution which merges the plan PR under the hood.

**Architecture:** The fix is entirely in `derivePipeline()` — the function that builds the pipeline steps for each issue group. The backend handler `submitToExecutionAgent` already merges the plan PR before starting execution (lines 318-341 of `submitToExecutionAgent.ts`), so no backend changes are needed.

**Tech Stack:** TypeScript, Vitest

---

## Bug Description

When a planning task produces a plan PR, and a review task reviews that PR and passes (`needs_remediation === '0'`), the code tasks list shows a **Merge** button instead of a **Code** button.

**Expected behavior:** The list shows a **Code** button. When clicked, the backend merges the plan PR under the hood and starts execution.

**Actual behavior:** The list shows a **Merge** button linking to the GitHub PR, requiring manual merge.

### Evidence

**`apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`**

1. **Lines 73-87 — Synthetic execution step:** Only added when `hasImplementationReadyLabel()` returns true (checks for `ready-to-implement` or `code-task` labels). When the issue only has `ready-to-merge` (set by review outcome), this check fails → no execution step added.

2. **Lines 110-124 — Review merge fallback:** Fires when review is completed with `needs_remediation === '0'` and `ready-to-merge` label. This fallback was designed for execution→review pipelines (where merge IS the terminal action), but it also fires for planning→review pipelines (where execution hasn't happened yet).

3. **Result:** Only a merge step is added → frontend renders Merge button.

**`apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts:318-341`** — The backend already handles merging the plan PR via `mergePlanPr()` before creating the execution task. This code path is triggered when the user clicks "Code".

---

## File Structure

- **Modify:** `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts` — Two changes in `derivePipeline()`
- **Test:** `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts` — New test cases for planning→review pipeline

---

### Task 1: Write failing test for planning→review pipeline showing Code action

**Files:**
- Test: `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`

- [ ] **Step 1: Write the failing test — planning→review pipeline should show execution (Code) action, not merge**

Add this test inside the `describe('derivePipeline', ...)` block, after the existing review merge-fallback tests (around line 504):

```typescript
  it('shows actionable execution step (not merge) when planning→review pipeline has completed review with ready-to-merge', () => {
    const tasks = [
      makeTask({
        id: 'task-planning',
        status: 'planned',
        agentType: 'planning',
        createdAt: '2026-03-01T10:00:00.000Z',
        linearIssue: {
          identifier: 'INT-100',
          parentIdentifier: null,
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-review',
        status: 'reviewed',
        agentType: 'review',
        prNumber: 42,
        createdAt: '2026-03-02T10:00:00.000Z',
        result: { needs_remediation: '0' },
        linearIssue: {
          identifier: 'INT-100',
          parentIdentifier: null,
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    // Should have an actionable execution step (Code button), NOT a merge step
    const executionStep = pipeline.steps.find((s) => s.agentType === 'execution');
    expect(executionStep).toBeDefined();
    expect(executionStep?.state).toBe('actionable');

    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeUndefined();
  });
```

- [ ] **Step 2: Write second failing test — planning→review with code-task label also shows execution, not merge**

Add below the previous test:

```typescript
  it('shows actionable execution step when planning→review pipeline has both code-task and ready-to-merge labels', () => {
    const tasks = [
      makeTask({
        id: 'task-planning',
        status: 'planned',
        agentType: 'planning',
        createdAt: '2026-03-01T10:00:00.000Z',
        linearIssue: {
          identifier: 'INT-100',
          parentIdentifier: null,
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'code-task' }, { name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-review',
        status: 'reviewed',
        agentType: 'review',
        prNumber: 42,
        createdAt: '2026-03-02T10:00:00.000Z',
        result: { needs_remediation: '0' },
        linearIssue: {
          identifier: 'INT-100',
          parentIdentifier: null,
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'code-task' }, { name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    const executionStep = pipeline.steps.find((s) => s.agentType === 'execution');
    expect(executionStep).toBeDefined();
    expect(executionStep?.state).toBe('actionable');

    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeUndefined();
  });
```

- [ ] **Step 3: Write third failing test — execution→review pipeline still shows merge (regression guard)**

This ensures the existing behavior for execution→review pipelines is preserved:

```typescript
  it('still shows merge step for execution→review pipeline (not planning) with ready-to-merge', () => {
    const tasks = [
      makeTask({
        id: 'task-execution',
        status: 'implemented',
        agentType: 'execution',
        createdAt: '2026-03-01T10:00:00.000Z',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
        linearIssue: {
          identifier: 'INT-100',
          parentIdentifier: null,
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-review',
        status: 'reviewed',
        agentType: 'review',
        prNumber: 42,
        createdAt: '2026-03-02T10:00:00.000Z',
        result: { needs_remediation: '0' },
        linearIssue: {
          identifier: 'INT-100',
          parentIdentifier: null,
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    // execution→review pipeline: merge IS the terminal action
    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeDefined();
    expect(mergeStep?.state).toBe('actionable');
  });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/p.buchman/personal/intexuraos-6 && pnpm vitest run apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`

Expected: The first two tests FAIL (merge step exists, no execution step). The third test PASSES (existing behavior).

- [ ] **Step 5: Commit failing tests**

```bash
git add apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts
git commit -m "test(code-agent): add failing tests for planning→review pipeline Code action

Planning→review pipelines should show a Code button (synthetic execution step),
not a Merge button. The backend already handles merging the plan PR under the hood
via submitToExecutionAgent.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Fix `derivePipeline()` to show Code action for planning→review pipelines

**Files:**
- Modify: `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts:69-124`

- [ ] **Step 1: Expand the synthetic execution step condition (lines 73-87)**

Replace the condition block at lines 73-87 with logic that also creates a synthetic execution step when a planning task has a completed review:

```typescript
  // Actionable logic: if planning completed and no execution step exists,
  // show the Code button (synthetic execution step) when:
  // 1. The issue has a ready-to-implement or code-task label (original behavior), OR
  // 2. A review step has completed (planning→review pipeline — the review approved the plan)
  const planningEntry = stepMap.get('planning');
  const executionEntry = stepMap.get('execution');
  const reviewEntry = stepMap.get('review');

  const planningCompletedNoExecution =
    planningEntry?.step.state === 'completed' &&
    executionEntry === undefined &&
    planningEntry.task.implementationTaskId === undefined &&
    (planningEntry.task.fanOutChildTaskIds === undefined || planningEntry.task.fanOutChildTaskIds.length === 0);

  const hasReviewApprovedPlan =
    reviewEntry?.step.state === 'completed' &&
    reviewEntry.task.result?.needs_remediation === REMEDIATION_NOT_NEEDED;

  if (
    planningCompletedNoExecution &&
    (hasImplementationReadyLabel(planningEntry.task.linearIssue?.labels) || hasReviewApprovedPlan === true)
  ) {
    // Insert synthetic execution step right after planning
    const planningIndex = steps.findIndex((s) => s.agentType === 'planning');
    steps.splice(planningIndex + 1, 0, {
      agentType: 'execution',
      state: 'actionable',
      label: 'Execution',
    });
  }
```

Note: The `reviewEntry` variable declaration that was previously at line 110 is now moved up. Remove the duplicate declaration at line 110.

- [ ] **Step 2: Add a guard to the review merge-fallback (lines 110-124)**

The review merge-fallback should NOT fire when this is a planning→review pipeline (planning exists, no execution). Replace lines 110-124 with:

```typescript
  // Merge-ready fallback for review tasks: if the review step completed with
  // needs_remediation === '0' AND the ready-to-merge label is still present.
  // The label check is essential: handlePrClose removes ready-to-merge when
  // a PR is closed (merged or not), preventing a stale merge button.
  // GUARD: skip for planning→review pipelines — the next step is execution, not merge.
  if (
    !hasActiveTask &&
    reviewEntry?.step.state === 'completed' &&
    reviewEntry.task.prNumber !== undefined &&
    reviewEntry.task.result?.needs_remediation === REMEDIATION_NOT_NEEDED &&
    hasMergeReadyLabel(reviewEntry.task.linearIssue?.labels) &&
    !steps.some((s) => s.agentType === 'merge') &&
    !(planningEntry !== undefined && executionEntry === undefined)
  ) {
    steps.push({
      agentType: 'merge',
      state: 'actionable',
      label: 'Merge',
    });
  }
```

The key addition is the last condition: `!(planningEntry !== undefined && executionEntry === undefined)` — this prevents the merge step from being added when we're in a planning→review pipeline.

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/p.buchman/personal/intexuraos-6 && pnpm vitest run apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`

Expected: ALL tests pass, including the new planning→review tests and all existing tests.

- [ ] **Step 4: Commit the fix**

```bash
git add apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts
git commit -m "fix(code-agent): show Code action for planning→review pipelines

derivePipeline() now distinguishes between execution→review pipelines
(where Merge is the terminal action) and planning→review pipelines
(where execution hasn't happened yet). The review merge-fallback is
guarded to not fire for planning→review, and the synthetic execution
step now also triggers when a review approved the plan.

The backend handler (submitToExecutionAgent) already merges the plan PR
under the hood before starting execution — no backend changes needed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Run full CI verification

**Files:**
- Verify: `apps/code-agent/`

- [ ] **Step 1: Run workspace verification**

Run: `cd /Users/p.buchman/personal/intexuraos-6 && pnpm run verify:workspace:tracked -- code-agent`

Expected: All tests pass, coverage meets thresholds.

- [ ] **Step 2: Run full CI**

Run: `cd /Users/p.buchman/personal/intexuraos-6 && pnpm run ci:tracked`

Expected: Clean pass across all workspaces.

- [ ] **Step 3: Final commit if any adjustments were needed**

If coverage exemptions or minor adjustments were needed, commit them.
