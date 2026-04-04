# Plan Review: Stop Auto-Advancing to Execution + Fix Planning→Review Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) When a review passes on a plan PR, the system must NOT auto-advance to execution — the user must explicitly trigger it. (2) When a planning→review pipeline completes, show the Code button (execution), not a Merge button.

**Architecture:** Three coordinated changes: (a) the webhook stops auto-setting `ready-to-implement` for plan-origin reviews, (b) the `derivePipeline()` function removes the label gate from the synthetic execution step AND guards the review merge-fallback to not fire for planning→review pipelines, (c) the detail view removes the label gate from the Implement button.

**Tech Stack:** TypeScript, Fastify, React, Vitest

---

## Background

### Problem 1: Auto-advancing to execution (INT-1255)

When a review task completes with `needs_remediation: '0'` and the origin task is a planning agent:
1. The webhook handler auto-sets `ready-to-implement` label on the Linear issue
2. `derivePipeline()` sees this label and inserts a synthetic "Execution: actionable" step
3. The UI shows the "Implement" button and `deriveAggregateStatus()` reports `needs-action`

Per user feedback (Piotr Buchman, 2026-04-04): execution should ONLY happen when the user explicitly decides to start coding. A passing plan review should leave the system in plan phase.

### Problem 2: Merge button instead of Code button (INT-1256)

When a planning task's review completes (plan PR approved), the code tasks list shows a **Merge** button instead of a **Code** button.

Root cause in `derivePipeline()` (`apps/web/src/utils/issueGroups.ts`):
1. **Lines 215-228 — Synthetic execution step:** Only added when `hasImplementationReadyLabel()` returns true. When the issue only has `ready-to-merge` (set by review outcome), this check fails → no execution step.
2. **Lines 247-258 — Review merge-fallback:** Fires when review completed with `needs_remediation === '0'` and `prNumber` exists. This fallback was designed for execution→review pipelines (where merge IS the terminal action), but it also fires for planning→review pipelines (where execution hasn't happened yet).
3. **Result:** Only a merge step is added → frontend renders Merge button.

The backend handler `submitToExecutionAgent` already merges the plan PR via `mergePlanPr()` before starting execution — no backend changes needed.

### Consolidated Design Decision: Remove label gate entirely

The `ready-to-implement` label was designed to gate the Implement button. However, the `code-task` label (always present on planned tasks) is also in `IMPLEMENTATION_READY_LABELS`, so removing just the auto-set of `ready-to-implement` would NOT change button visibility (the label check would still pass via `code-task`). Two options were considered:

1. **Remove `code-task` from the label set** — Forces manual `ready-to-implement` label addition on Linear (poor UX)
2. **Remove the label gate entirely** — Button appears when planning completes; user's click IS the explicit trigger

**Chosen: Option 2.** The Implement button already requires a user click. Removing the label gate makes the button always available after planning, and the user decides when to start execution.

Additionally, the review merge-fallback must be guarded so it does NOT fire for planning→review pipelines. Without this guard, removing the label gate would cause BOTH Code and Merge buttons to appear.

### What stays unchanged

- `ready-to-merge` label: still auto-set for execution-origin reviews
- `hasImplementationReadyLabel()` function: kept for backward compat (still exported, still tested)
- `submitToExecutionAgent` validation: still requires `code-task` or `complex-task` label on the Linear issue
- Remediation flow: `needs_remediation === '1'` still creates remediation tasks and removes stale labels
- `ready-to-implement` label removal on negative reviews: still happens (cleanup of stale labels)

### Endpoint Changes

No HTTP endpoints are modified, created, or removed.

---

## File Map

| Action | File                                                              | Responsibility                                               |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| Modify | `apps/code-agent/src/routes/webhookRoutes.ts:1177-1181`           | Skip `ready-to-implement` label for plan-origin reviews      |
| Test   | `apps/code-agent/src/__tests__/routes/webhooks.test.ts:4738-4801` | Update review-outcome label tests                            |
| Modify | `apps/web/src/utils/issueGroups.ts:213-258`                       | Remove label gate from execution step + guard merge-fallback |
| Test   | `apps/web/src/utils/__tests__/issueGroups.test.ts:1085-1181`      | Update label-gated tests + add planning→review tests         |
| Modify | `apps/web/src/pages/CodeTaskViewPageV2.tsx:124-127`               | Remove `hasImplementationReadyLabel` from `isImplementable`  |

---

### Task 1: Stop auto-setting `ready-to-implement` for plan-origin reviews

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:1177-1181`
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts:4738-4801`

- [ ] **Step 1: Update the test — plan-origin review should NOT set `ready-to-implement`**

In `apps/code-agent/src/__tests__/routes/webhooks.test.ts`, find the test at line 4738 (`'adds ready-to-implement label when origin task is a planning task'`). Change the test name and assertion to verify NO label is set:

```typescript
    it('does NOT set ready-to-implement label when origin task is a planning task', async () => {
      await createOriginTask({ traceId: 'trace_label_planning', agentType: 'planning' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_planning_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const { linearAgentClient: lac } = getServices();
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      // Plan-origin reviews skip labeling entirely — no ready-to-implement set
      expect(metadataSpy).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Update the walk-past test — PR walk should also NOT set label**

Find the test at line 4777 (`'walks past pull_request task to find planning origin and sets ready-to-implement'`). Change the test name and assertion:

```typescript
    it('walks past pull_request task to find planning origin and does NOT set ready-to-implement', async () => {
      const planningTask = await createOriginTask({ traceId: 'trace_label_pr_task_planning', agentType: 'planning' });
      await codeTaskRepo.update(planningTask.id, { status: 'planned' });
      await createOriginTask({ traceId: 'trace_label_pr_task_newer', agentType: 'pull_request' });

      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_pr_task_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      // Plan-origin reviews skip labeling entirely
      const { linearAgentClient: lac } = getServices();
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      expect(metadataSpy).not.toHaveBeenCalled();
    });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`
Expected: FAIL — the webhook still sets `ready-to-implement` for planning-origin reviews.

- [ ] **Step 4: Modify the webhook handler to skip label for plan-origin reviews**

In `apps/code-agent/src/routes/webhookRoutes.ts`, at lines 1177-1181, the current code is:

```typescript
                if (originResult.ok && originResult.value !== null && originResult.value.linearIssueId !== undefined) {
                  targetLinearIssueId = originResult.value.linearIssueId;
                  targetUserId = originResult.value.userId;
                  label = originResult.value.agentType === 'planning' ? 'ready-to-implement' : 'ready-to-merge';
                  source = 'origin';
```

First, update the variable declarations (lines 1172-1175) to avoid TS2454 definite-assignment errors — the planning branch intentionally leaves all four variables unassigned:

```typescript
                let targetLinearIssueId: string | undefined;
                let targetUserId: string | undefined;
                let label: string | undefined;
                let source: string | undefined;
```

Then replace lines 1177-1181 with:

```typescript
                if (originResult.ok && originResult.value !== null && originResult.value.linearIssueId !== undefined) {
                  if (originResult.value.agentType === 'planning') {
                    // Plan-phase reviews do not auto-advance to execution.
                    // The user must explicitly trigger execution from the UI.
                    request.log.info({ taskId, prNumber, linearIssueId: originResult.value.linearIssueId },
                      'Plan review passed — skipping ready-to-implement label (user must explicitly trigger execution)');
                  } else {
                    targetLinearIssueId = originResult.value.linearIssueId;
                    targetUserId = originResult.value.userId;
                    label = 'ready-to-merge';
                    source = 'origin';
                  }
```

And update the downstream `else` block at line 1203 to narrow the types before use:

```typescript
                } else {
                  // targetUserId, label, and source are guaranteed defined when
                  // targetLinearIssueId is defined (both branches assign all four or none)
                  const issueValidation = await linearAgentClient.validateIssue({
                    userId: targetUserId!,
                    identifier: targetLinearIssueId,
                  });
                  if (issueValidation.ok) {
                    const labelResult = await linearAgentClient.updateIssueMetadata({
                      userId: targetUserId!,
                      issueId: issueValidation.value.id,
                      addLabels: [label!],
                    });
```

Note: The non-null assertions (`!`) are safe here because when `targetLinearIssueId` is defined (we're in the else branch), all four variables were assigned in the same code path. Alternatively, the implementer may use a structured `target` object pattern to avoid assertions entirely — either approach is acceptable.

When origin is `planning`, `targetLinearIssueId` stays `undefined`, so the rest of the label-setting block (line 1200: `if (targetLinearIssueId === undefined) { ... skipping }`) is naturally skipped.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "fix: stop auto-setting ready-to-implement for plan-origin reviews

Plan-phase reviews that pass (needs_remediation: '0') no longer auto-set
the ready-to-implement label. Execution must be explicitly triggered by
the user from the UI. Execution-origin reviews still set ready-to-merge.

Part of INT-1255"
```

---

### Task 2: Remove label gate from pipeline + guard merge-fallback for planning→review

**Files:**
- Modify: `apps/web/src/utils/issueGroups.ts:213-258`
- Test: `apps/web/src/utils/__tests__/issueGroups.test.ts:1085-1181`

This task addresses both INT-1255 (remove label gate) and INT-1256 (guard merge-fallback).

- [ ] **Step 1: Update failing test — execution should be actionable WITHOUT label**

In `apps/web/src/utils/__tests__/issueGroups.test.ts`, find the test at line 1153 (`'does NOT show actionable when linearIssue has labels but neither ready-to-implement nor code-task'`). Change it to expect actionable:

```typescript
  it('shows actionable even when linearIssue has labels without ready-to-implement or code-task', () => {
    const task = createMockTask({
      id: 't1',
      linearIssueId: 'INT-100',
      agentType: 'planning',
      status: 'planned',
      linearIssue: {
        ...linearIssueSkeleton,
        labels: [{ id: 'l1', name: 'some-other-label' }],
      },
    });
    const groups = groupByLinearIssue([task]);
    expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('actionable');
  });
```

- [ ] **Step 2: Update second failing test — `unclear` label should also show actionable**

Find the test at line 1168 (`'does NOT show actionable when linearIssue has only unclear label'`). Change it:

```typescript
  it('shows actionable even when linearIssue has only unclear label', () => {
    const task = createMockTask({
      id: 't1',
      linearIssueId: 'INT-100',
      agentType: 'planning',
      status: 'planned',
      linearIssue: {
        ...linearIssueSkeleton,
        labels: [{ id: 'l1', name: 'unclear' }],
      },
    });
    const groups = groupByLinearIssue([task]);
    expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('actionable');
  });
```

- [ ] **Step 3: Add new test — planning→review pipeline shows Code (execution), not Merge**

Add this test inside the `describe('groupByLinearIssue', ...)` block, after the existing review/merge tests (around line 1460):

```typescript
  it('shows actionable execution step (not merge) when planning→review pipeline has completed review', () => {
    const tasks = [
      createMockTask({
        id: 'task-planning',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:05:00Z',
      }),
      createMockTask({
        id: 'task-review',
        linearIssueId: 'INT-100',
        agentType: 'review',
        status: 'reviewed',
        prNumber: 42,
        createdAt: '2026-03-02T10:00:00Z',
        updatedAt: '2026-03-02T10:05:00Z',
        result: { needs_remediation: '0' },
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    // Should have an actionable execution step (Code button), NOT a merge step
    const executionStep = findStep(groups[0]?.pipeline, 'execution');
    expect(executionStep).toBeDefined();
    expect(executionStep?.state).toBe('actionable');

    const mergeStep = findStep(groups[0]?.pipeline, 'merge');
    expect(mergeStep).toBeUndefined();
  });
```

- [ ] **Step 4: Add regression test — execution→review pipeline still shows Merge**

Add right after the previous test:

```typescript
  it('still shows merge step for execution→review pipeline (regression guard)', () => {
    const tasks = [
      createMockTask({
        id: 'task-execution',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'implemented',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:05:00Z',
        result: { prUrl: 'https://github.com/org/repo/pull/42' },
      }),
      createMockTask({
        id: 'task-review',
        linearIssueId: 'INT-100',
        agentType: 'review',
        status: 'reviewed',
        prNumber: 42,
        createdAt: '2026-03-02T10:00:00Z',
        updatedAt: '2026-03-02T10:05:00Z',
        result: { needs_remediation: '0' },
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    // execution→review pipeline: merge IS the terminal action
    const mergeStep = findStep(groups[0]?.pipeline, 'merge');
    expect(mergeStep).toBeDefined();
    expect(mergeStep?.state).toBe('actionable');
  });

  it('shows merge step when execution task is archived but implementationTaskId is set (edge case)', () => {
    const tasks = [
      createMockTask({
        id: 'task-planning',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        implementationTaskId: 'task-execution-archived',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:05:00Z',
      }),
      createMockTask({
        id: 'task-execution-archived',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'archived',
        createdAt: '2026-03-02T10:00:00Z',
        updatedAt: '2026-03-02T10:05:00Z',
      }),
      createMockTask({
        id: 'task-review',
        linearIssueId: 'INT-100',
        agentType: 'review',
        status: 'reviewed',
        prNumber: 42,
        createdAt: '2026-03-03T10:00:00Z',
        updatedAt: '2026-03-03T10:05:00Z',
        result: { needs_remediation: '0' },
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    // Execution was started (implementationTaskId set) but task archived —
    // merge IS correct because execution already happened
    const mergeStep = findStep(groups[0]?.pipeline, 'merge');
    expect(mergeStep).toBeDefined();
    expect(mergeStep?.state).toBe('actionable');
  });
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- web 2>&1 | tail -30`
Expected: FAIL — the label-gated tests now expect actionable but still get undefined, and the planning→review test gets a merge step instead of execution.

- [ ] **Step 6: Remove label gate from synthetic execution step**

In `apps/web/src/utils/issueGroups.ts`, replace lines 210-228:

```typescript
  // Actionable logic: if planning completed, no execution step exists, no implementationTaskId,
  // AND the Linear issue has a ready-to-implement or code-task label (backward compat).
  // Falls back to allowing actionable if label data is unavailable.
  const planningEntry = stepMap.get('planning');
  const executionEntry = stepMap.get('execution');
  if (
    planningEntry?.step.state === 'completed' &&
    executionEntry === undefined &&
    planningEntry.task.implementationTaskId === undefined &&
    hasImplementationReadyLabel(planningEntry.task.linearIssue?.labels)
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

With:

```typescript
  // Actionable logic: if planning completed, no execution step exists, and no
  // implementationTaskId — the user can trigger execution from the UI.
  const planningEntry = stepMap.get('planning');
  const executionEntry = stepMap.get('execution');
  if (
    planningEntry?.step.state === 'completed' &&
    executionEntry === undefined &&
    planningEntry.task.implementationTaskId === undefined
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

- [ ] **Step 7: Guard the review merge-fallback for planning→review pipelines**

In the same file, replace lines 243-258:

```typescript
  // Merge-ready fallback for review tasks: if the review step completed with
  // needs_remediation === '0', the PR is mergeable even without the ready-to-merge
  // label (which may have been set on the origin task's Linear issue instead).
  const reviewEntry = stepMap.get('review');
  if (
    reviewEntry?.step.state === 'completed' &&
    reviewEntry.task.prNumber !== undefined &&
    reviewEntry.task.result?.needs_remediation === REMEDIATION_NOT_NEEDED &&
    !steps.some((s) => s.agentType === 'merge')
  ) {
    steps.push({
      agentType: 'merge',
      state: 'actionable',
      label: 'Merge',
    });
  }
```

With:

```typescript
  // Merge-ready fallback for review tasks: if the review step completed with
  // needs_remediation === '0', the PR is mergeable even without the ready-to-merge
  // label (which may have been set on the origin task's Linear issue instead).
  // GUARD: skip for planning→review pipelines where execution hasn't started yet.
  // The backend (submitToExecutionAgent) merges the plan PR under the hood.
  const reviewEntry = stepMap.get('review');
  if (
    reviewEntry?.step.state === 'completed' &&
    reviewEntry.task.prNumber !== undefined &&
    reviewEntry.task.result?.needs_remediation === REMEDIATION_NOT_NEEDED &&
    !steps.some((s) => s.agentType === 'merge') &&
    !(planningEntry !== undefined && planningEntry.task.implementationTaskId === undefined)
  ) {
    steps.push({
      agentType: 'merge',
      state: 'actionable',
      label: 'Merge',
    });
  }
```

The guard `!(planningEntry !== undefined && planningEntry.task.implementationTaskId === undefined)` checks whether execution has ever been started, rather than relying on whether an execution task exists in `stepMap`. This handles the edge case where an execution task has been archived (excluded from `stepMap` at line 189) — `implementationTaskId` on the planning task would still be set, so the merge fallback would correctly fire. The `planningEntry` variable is already declared above (line 213).

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- web 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/utils/issueGroups.ts apps/web/src/utils/__tests__/issueGroups.test.ts
git commit -m "fix: remove label gate from pipeline + guard merge-fallback for planning→review

The synthetic execution step now appears whenever planning is completed,
regardless of labels. The review merge-fallback is guarded to not fire
for planning→review pipelines (where the next step is execution, not merge).

Fixes INT-1256, part of INT-1255"
```

---

### Task 3: Remove label gate from web app detail view

**Files:**
- Modify: `apps/web/src/pages/CodeTaskViewPageV2.tsx:124-127`

- [ ] **Step 1: Remove `hasImplementationReadyLabel` from `isImplementable`**

In `apps/web/src/pages/CodeTaskViewPageV2.tsx`, replace lines 124-127:

```typescript
  const isImplementable = task.status === 'planned' &&
    task.implementationTaskId === undefined &&
    task.linearIssueId !== undefined &&
    hasImplementationReadyLabel(task.linearIssue?.labels);
```

With:

```typescript
  const isImplementable = task.status === 'planned' &&
    task.implementationTaskId === undefined &&
    task.linearIssueId !== undefined;
```

- [ ] **Step 2: Remove the unused import**

Check if `hasImplementationReadyLabel` is still used elsewhere in the file. At line 22:

```typescript
import { hasImplementationReadyLabel, isTaskMergeable, getTaskMergeUrl } from '@/utils/issueGroups.js';
```

Replace with:

```typescript
import { isTaskMergeable, getTaskMergeUrl } from '@/utils/issueGroups.js';
```

- [ ] **Step 3: Verify the web app builds**

Run: `cd /repo && pnpm run verify:workspace:tracked -- web 2>&1 | tail -30`
Expected: PASS (build + lint + type-check succeed)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/CodeTaskViewPageV2.tsx
git commit -m "fix: remove label gate from Implement button in task detail view

The Implement button now shows for any completed planning task with a
Linear issue. No label check required — the user's click is the trigger.

Part of INT-1255"
```

---

### Task 4: Run full CI and verify

- [ ] **Step 1: Build all packages**

Run: `cd /repo && pnpm build`

- [ ] **Step 2: Run full CI check**

Run: `cd /repo && pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int-1255.txt`
Expected: PASS

- [ ] **Step 3: If any failures, investigate and fix**

Capture: `rg "error|FAIL" -C3 /tmp/ci-output-int-1255.txt`

Fix any issues before proceeding.

---

## Out of Scope

1. **Group summary `hasImplementationTaskId` staleness bug**: The `codeTaskRepositoryWithGroupUpdates` decorator doesn't trigger summary updates when `implementationTaskId` changes (only on status changes). Track as a separate issue.

2. **Linear assignment triggering execution**: The user mentioned execution can be triggered "from linear by assigning that task to someone." This is a separate feature — no current webhook maps Linear assignment to execution dispatch.

3. **`hasImplementationReadyLabel` cleanup**: The function, label constants, and Firestore field remain in the codebase. They're still exported and tested but no longer gate UI behavior. A follow-up can clean up the dead code path if desired.

4. **Planning task re-triggering on PR events** (reported by @pbuchman, 2026-04-04): When reviews or comments are posted on a planning PR, the webhook dispatch service (`gitHubDispatchService.ts`) routes the `pull_request_review` event through the standard dispatch flow, which creates or sends a message to a PR task. This task runs as the planning agent, causing the planning phase to re-execute even though the plan is already complete. This is the same re-trigger pattern as the execution auto-advancing addressed in this plan, but at the dispatch/orchestration level rather than the label/pipeline level. The fix would require the dispatch rules (`gitHubWebhookRules.ts`) or the dispatch service to detect that a planning PR already has a completed plan and skip re-dispatch. Track as a separate issue.
