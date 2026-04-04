# Plan Review: Stop Auto-Advancing to Execution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a review passes on a plan PR (`needs_remediation: '0'`), the system should NOT auto-set the `ready-to-implement` label or auto-advance to the execution pipeline step. Execution must only happen when the user explicitly triggers it from the UI.

**Architecture:** Currently, a passing plan review auto-sets `ready-to-implement` on the Linear issue, which gates the "Implement" button via `hasImplementationReadyLabel()` in both the backend pipeline derivation and the web app detail view. This plan removes the auto-label behavior for plan-origin reviews AND removes the label gate from the Implement button. The button appears whenever planning is completed. The user's explicit click of "Implement" is the sole trigger for execution. The `ready-to-implement` label and `hasImplementationReadyLabel()` function remain in the codebase for the `recomputeWithLabels` infrastructure but no longer gate the UI.

**Tech Stack:** TypeScript, Fastify, React, Vitest

---

## Background

### Problem

When a review task completes with `needs_remediation: '0'` (review passed) and the origin task is a planning agent:
1. The webhook handler auto-sets `ready-to-implement` label on the Linear issue
2. `derivePipeline()` sees this label and inserts a synthetic "Execution: actionable" step
3. The UI shows the "Implement" button
4. `deriveAggregateStatusFromSummary()` reports `needs-action`

Per user feedback (Piotr Buchman, 2026-04-04): execution should ONLY happen when the user explicitly decides to start coding. A passing plan review should leave the system in plan phase. If the user later posts another review (disagreeing with the automated assessment), it should trigger remediation again through the normal flow.

### Design Decision: Remove the label gate entirely

The `ready-to-implement` label was designed to gate the Implement button. However, the `code-task` label (always present on planned tasks) is also in `IMPLEMENTATION_READY_LABELS`, so removing just the auto-set would NOT change button visibility. Two options were considered:

1. **Remove `code-task` from the label set** — Forces manual `ready-to-implement` label addition on Linear (poor UX)
2. **Remove the label gate entirely** — Button appears when planning completes; user's click IS the explicit trigger

**Chosen: Option 2.** The Implement button already requires a user click. Removing the label gate makes the button always available after planning, and the user decides when to start execution. No auto-advancement, no auto-labeling.

### What stays unchanged

- `ready-to-merge` label: still auto-set for execution-origin reviews (review passes on implementation PR)
- `hasImplementationReadyLabel()` function: kept for `recomputeWithLabels` infrastructure and backward compat
- `submitToExecutionAgent` validation: still requires `code-task` or `complex-task` label on the Linear issue
- Remediation flow: `needs_remediation === '1'` still creates remediation tasks and removes stale labels
- The `ready-to-implement` label removal on negative reviews: still happens (cleanup of stale labels)

### Endpoint Changes

No HTTP endpoints are modified, created, or removed.

---

## File Map

| Action   | File                                                                                          | Responsibility                                                       |
| -------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Modify   | `apps/code-agent/src/routes/webhookRoutes.ts:1247-1250`                                       | Skip `ready-to-implement` label for plan-origin reviews              |
| Modify   | `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts:73-78`                        | Remove `hasImplementationReadyLabel` from execution actionable check |
| Modify   | `apps/code-agent/src/domain/issueGrouping/deriveAggregateStatusFromSummary.ts:31-37`          | Remove `hasImplementationReadyLabel` from needs-action check         |
| Modify   | `apps/web/src/pages/CodeTaskViewPage.tsx:127-130`                                             | Remove `hasImplementationReadyLabel` from `isImplementable`          |
| Modify   | `apps/code-agent/src/__tests__/routes/webhooks.test.ts`                                       | Update review-outcome label tests                                    |
| Modify   | `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`               | Remove label-gated execution tests                                   |
| Modify   | `apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts` | Remove label-gated needs-action tests                                |

---

### Task 1: Stop auto-setting `ready-to-implement` for plan-origin reviews

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:1247-1250`
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

- [ ] **Step 1: Update the failing test — plan-origin review should NOT set `ready-to-implement`**

In `apps/code-agent/src/__tests__/routes/webhooks.test.ts`, find the test `'adds ready-to-implement label when origin task is a planning task'` (around line 4867). Change the assertion to verify that NO `ready-to-implement` label is added:

```typescript
it('does not set ready-to-implement label when origin task is a planning task', async () => {
  await createOriginTask({ traceId: 'trace_label_planning', agentType: 'planning' });
  const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_planning_review' });

  await completeReviewWithLabel(reviewTask.id, { needs_remediation: '0' });

  const labelCalls = metadataSpy.mock.calls.filter(
    (call) => call[0].addLabels !== undefined &&
      call[0].addLabels.includes('ready-to-implement')
  );
  expect(labelCalls).toHaveLength(0);
});
```

Also find and update `'walks past pull_request task to find planning origin and sets ready-to-implement'` (around line 4906) — same pattern: assert that no `ready-to-implement` label is added.

```typescript
it('walks past pull_request task to find planning origin and does NOT set ready-to-implement', async () => {
  await createOriginTask({ traceId: 'trace_label_pr_walk', agentType: 'planning' });
  await createOriginTask({ traceId: 'trace_label_pr_walk_pr', agentType: 'pull_request' });
  const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_pr_walk_review' });

  await completeReviewWithLabel(reviewTask.id, { needs_remediation: '0' });

  const labelCalls = metadataSpy.mock.calls.filter(
    (call) => call[0].addLabels !== undefined &&
      call[0].addLabels.includes('ready-to-implement')
  );
  expect(labelCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`
Expected: FAIL — the webhook still sets `ready-to-implement` for planning-origin reviews.

- [ ] **Step 3: Modify the webhook handler to skip label for plan-origin reviews**

In `apps/code-agent/src/routes/webhookRoutes.ts`, around line 1247-1251, the current code is:

```typescript
if (originResult.ok && originResult.value !== null && originResult.value.linearIssueId !== undefined) {
  targetLinearIssueId = originResult.value.linearIssueId;
  targetUserId = originResult.value.userId;
  label = originResult.value.agentType === 'planning' ? 'ready-to-implement' : 'ready-to-merge';
  source = 'origin';
```

Change it to skip the label entirely when origin is a planning task. The execution-origin path (`ready-to-merge`) is preserved:

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

Note: `targetLinearIssueId` remains `undefined` for planning-origin, so the rest of the label-setting block (lines 1270-1316) is skipped due to the existing guard: `if (targetLinearIssueId === undefined) { ... skipping }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "fix: stop auto-setting ready-to-implement for plan-origin reviews

Plan-phase reviews that pass (needs_remediation: '0') no longer auto-set
the ready-to-implement label. Execution must be explicitly triggered by
the user from the UI. Execution-origin reviews still set ready-to-merge.

Fixes INT-1255"
```

---

### Task 2: Remove label gate from pipeline derivation

**Files:**
- Modify: `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts:73-78`
- Test: `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`

- [ ] **Step 1: Update the test — execution should be actionable without `ready-to-implement` label**

In `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`, find the test `'does not create actionable execution step without ready-to-implement label'` (around line 366). This test asserts that without the label, no actionable step exists. Reverse the assertion:

```typescript
it('creates actionable execution step for completed planning even without ready-to-implement label', () => {
  const tasks = [
    makeTask({
      id: 'task-plan',
      agentType: 'planning',
      status: 'planned',
      linearIssueId: 'INT-100',
      linearIssue: {
        identifier: 'INT-100',
        title: 'Test issue',
        status: 'In Progress',
        priority: 1,
        assignee: null,
        labels: [{ name: 'some-other-label' }],
        url: 'https://linear.app/INT-100',
        commentCount: 0,
      },
    }),
  ];
  const pipeline = derivePipeline(tasks);
  const actionable = pipeline.steps.find((s) => s.state === 'actionable');
  expect(actionable).toBeDefined();
  expect(actionable?.agentType).toBe('execution');
});
```

Also, update all existing tests that set `labels: [{ name: 'ready-to-implement' }]` to verify the behavior works regardless of the label. Tests that pass `ready-to-implement` labels are fine — they should still produce actionable execution steps. But add a variant without the label to confirm it also works.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`
Expected: FAIL — `derivePipeline` still checks `hasImplementationReadyLabel`.

- [ ] **Step 3: Remove the label gate from `derivePipeline`**

In `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`, lines 73-78:

Replace:
```typescript
  if (
    planningEntry?.step.state === 'completed' &&
    executionEntry === undefined &&
    planningEntry.task.implementationTaskId === undefined &&
    (planningEntry.task.fanOutChildTaskIds === undefined || planningEntry.task.fanOutChildTaskIds.length === 0) &&
    hasImplementationReadyLabel(planningEntry.task.linearIssue?.labels)
  ) {
```

With:
```typescript
  if (
    planningEntry?.step.state === 'completed' &&
    executionEntry === undefined &&
    planningEntry.task.implementationTaskId === undefined &&
    (planningEntry.task.fanOutChildTaskIds === undefined || planningEntry.task.fanOutChildTaskIds.length === 0)
  ) {
```

Remove the `hasImplementationReadyLabel` import if it's no longer used in this file. Check other usages first:

```bash
grep -n 'hasImplementationReadyLabel' apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts
```

If it's only on the deleted line, remove the import. If used elsewhere, keep it.

Also update the comment on lines 69-70 to remove the label reference:

Replace:
```typescript
  // Actionable logic: if planning completed, no execution step exists, no implementationTaskId,
  // AND the Linear issue has a ready-to-implement or code-task label (backward compat).
```

With:
```typescript
  // Actionable logic: if planning completed, no execution step exists, no implementationTaskId,
  // and no fan-out children — the user can trigger execution.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts
git commit -m "fix: remove label gate from execution actionable pipeline step

The Implement button now appears whenever planning is completed, regardless
of the ready-to-implement label. The user's explicit click is the trigger.

Part of INT-1255"
```

---

### Task 3: Remove label gate from aggregate status summary

**Files:**
- Modify: `apps/code-agent/src/domain/issueGrouping/deriveAggregateStatusFromSummary.ts:31-37`
- Test: `apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts`

- [ ] **Step 1: Update the test — `hasImplementationReadyLabel: false` should still yield `needs-action`**

In `apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts`, find the test `'does not return needs-action for planning case when hasImplementationReadyLabel is false'` (around line 224). Change the assertion:

```typescript
it('returns needs-action for planning case even when hasImplementationReadyLabel is false', () => {
  expect(
    deriveAggregateStatusFromSummary({
      ...BASE_FIELDS,
      hasCompletedPlanning: true,
      hasCompletedExecution: false,
      hasImplementationTaskId: false,
      hasImplementationReadyLabel: false,
    }),
  ).toBe('needs-action');
});
```

Keep the other label-related tests (`hasImplementationReadyLabel is undefined` and `hasImplementationReadyLabel is true`) but update their descriptions if needed — they should all return `needs-action`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`
Expected: FAIL — `deriveAggregateStatusFromSummary` still checks the label.

- [ ] **Step 3: Remove the label check from `deriveAggregateStatusFromSummary`**

In `apps/code-agent/src/domain/issueGrouping/deriveAggregateStatusFromSummary.ts`, lines 29-38:

Replace:
```typescript
  // 2. Needs-action: planning completed but no execution yet
  // Pessimistic when label unknown (undefined → true), accurate when set
  if (
    fields.hasCompletedPlanning &&
    !fields.hasCompletedExecution &&
    !fields.hasImplementationTaskId &&
    (fields.hasImplementationReadyLabel ?? true)
  ) {
    return 'needs-action';
  }
```

With:
```typescript
  // 2. Needs-action: planning completed but no execution yet
  if (
    fields.hasCompletedPlanning &&
    !fields.hasCompletedExecution &&
    !fields.hasImplementationTaskId
  ) {
    return 'needs-action';
  }
```

Note: Keep the `hasImplementationReadyLabel` field in the `GroupSummaryFields` interface — it's still written by `recomputeWithLabels` and stored in Firestore. Removing it would require a data migration. It's simply no longer read during status derivation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/deriveAggregateStatusFromSummary.ts apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts
git commit -m "fix: remove label gate from aggregate status needs-action check

Planning completed + no execution = needs-action, regardless of
ready-to-implement label presence.

Part of INT-1255"
```

---

### Task 4: Remove label gate from web app detail view

**Files:**
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx:127-130`

- [ ] **Step 1: Remove `hasImplementationReadyLabel` from `isImplementable`**

In `apps/web/src/pages/CodeTaskViewPage.tsx`, line 127-130:

Replace:
```typescript
  const isImplementable = task.status === 'planned' &&
    implementationTaskIds.length === 0 &&
    task.linearIssueId !== undefined &&
    hasImplementationReadyLabel(task.linearIssue?.labels);
```

With:
```typescript
  const isImplementable = task.status === 'planned' &&
    implementationTaskIds.length === 0 &&
    task.linearIssueId !== undefined;
```

Remove the `hasImplementationReadyLabel` import if no longer used in this file:

```bash
grep -n 'hasImplementationReadyLabel' apps/web/src/pages/CodeTaskViewPage.tsx
```

If only used on the deleted line, remove the import from the imports block (likely imported from `@/utils/issueGroups`).

- [ ] **Step 2: Verify the web app builds**

Run: `cd /repo && pnpm run verify:workspace:tracked -- web 2>&1 | tail -30`
Expected: PASS (build + lint + type-check succeed)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/CodeTaskViewPage.tsx
git commit -m "fix: remove label gate from Implement button in task detail view

The Implement button now shows for any completed planning task with a
Linear issue. No label check required.

Part of INT-1255"
```

---

### Task 5: Run full CI and verify

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

3. **`hasImplementationReadyLabel` cleanup**: The function, label constants, and Firestore field remain in the codebase. They're still written by `recomputeWithLabels` but no longer gate UI behavior. A follow-up can clean up the dead code path if desired.
