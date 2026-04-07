# Label-Gated "Implement" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the "Implement" / "Code" button in the web app behind a `ready-to-implement` Linear label, so the button only appears when a review process has confirmed the plan is ready — not immediately when planning completes.

**Architecture:** The web app currently shows the "Implement" button purely based on task status (`planned`) and the absence of an execution task. This plan adds a label-based gate: a new `ready-to-implement` label in Linear becomes the source of truth for UI button visibility. The label data is already hydrated from the Linear API into `CodeTask.linearIssue.labels` on every list/get request — no new API plumbing is needed. A backward-compatibility fallback preserves behavior for tasks planned before this system is deployed. A shared `hasImplementationReadyLabel()` helper in `issueGroups.ts` encapsulates the label-check + backward-compat logic for reuse across both list and detail views.

**Tech Stack:** TypeScript, React, Vitest, `@intexuraos/common-core` (`normalizeLabel`)

---

## Current Architecture (Reference)

### How the "Implement" button is currently shown

**List view** (`IssueGroupRow.tsx`):
- A green "Implement" (desktop) / "Code" (mobile) button renders when `hasActionable` is true
- `hasActionable = pipeline.steps.some(s => s.state === 'actionable')`

**Pipeline derivation** (`issueGroups.ts:112-127`):
- `derivePipeline()` creates a synthetic "execution" step with `state: 'actionable'` when ALL of:
  1. Planning step's state is `completed` (task status is `planned`)
  2. No execution step exists yet
  3. `planningEntry.task.implementationTaskId === undefined`

**Detail view** (`CodeTaskViewPageV2.tsx:123-125`):
```typescript
const isImplementable = task.status === 'planned' &&
  task.implementationTaskId === undefined &&
  task.linearIssueId !== undefined;
```

### Label data availability in the web app

Labels are already hydrated:
- **List endpoint** (`GET /code/tasks`): code-agent calls `linearAgentClient.fetchIssuesForDisplay()` for all Linear issue IDs, returns `linearIssue.labels` array
- **Single task endpoint** (`GET /code/tasks/:taskId`): code-agent calls `linearAgentClient.fetchIssueForDisplay()`, returns `linearIssue.labels`
- **Web type**: `CodeTask.linearIssue.labels: { id: string; name: string }[]`

No new API endpoint or data plumbing is required.

### Existing label utilities

`packages/common-core/src/labels.ts` provides:
- `normalizeLabel(label: string): string` — lowercases, replaces spaces/underscores with hyphens
- `hasCodeTaskLabel(labels: string[])` — detects `code-task`
- `hasPlanningTaskLabel(labels: string[])` — detects `planning-task`
- `hasComplexTaskLabel(labels: string[])` — detects `complex-task`

These take `string[]` (label names). The web app's label data is `{ id: string; name: string }[]`, so these are not directly usable. This plan creates a web-specific helper that works with the object-shaped label arrays.

---

## Design Decisions

### Label name: `ready-to-implement`

Following the existing convention (`code-task`, `planning-task`, `complex-task`, `unclear`), the new label is `ready-to-implement`. This label is:
- Added to the Linear issue by the review process ("Need Pick New Car") when it confirms the plan is implementation-ready
- Checked by the web UI to gate the "Implement" button
- Purely a UI signal — does NOT affect backend execution logic or the `submitToExecutionAgent` use case

### Future label: `ready-to-merge`

A future iteration will add a `ready-to-merge` label that signals a PR needs no more review changes. This will enable a "Merge" button in the UI. The architecture established here (the `hasImplementationReadyLabel` pattern in pipeline derivation and detail view) is designed to be trivially extensible — a `hasMergeReadyLabel` helper follows the same pattern.

### Backward compatibility strategy

When this feature deploys, existing `planned` tasks will NOT have the `ready-to-implement` label. To avoid breaking the UX:

- If `linearIssue.labels` includes `ready-to-implement` → show button (new gated behavior)
- If `linearIssue` is undefined (Linear hydration failed, or very old task) → show button using current logic (graceful fallback)
- If `linearIssue.labels` is an empty array `[]` → show button (graceful fallback — issue may have no labels at all)
- If `linearIssue` is available AND has `code-task` label but NOT `ready-to-implement` → show button (backward compat for pre-existing planned tasks)
- If `linearIssue` is available AND has labels but NEITHER `code-task` NOR `ready-to-implement` → do NOT show button

**Rationale:** The `code-task` label is stamped by `enforcePlanningOutcome()` on all successfully planned simple tasks. So `code-task` without `ready-to-implement` means "planned before the new system" → allow. Once the review process is active, new tasks will get `ready-to-implement` instead of (or in addition to) `code-task` on the parent issue. Empty arrays and undefined are both "no data" situations that should not block users.

### Where the label will be added (contract for future integration)

The `ready-to-implement` label should be added by whichever process reviews the planning PR and confirms it's ready. The integration point is:

**`apps/code-agent/src/routes/webhookRoutes.ts`** — in the webhook callback handler, after a `plan_review` or review task completes with no outstanding changes. The call would be:
```typescript
await linearAgentClient.updateIssueMetadata({
  userId: task.userId,
  issueId: originalIssueUuid,
  addLabels: ['ready-to-implement'],
});
```

This is **NOT in scope for this task** — it will be implemented when the review process ("Need Pick New Car") is built or enhanced. This task only implements the UI side.

---

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** `GET /code/tasks`, `GET /code/tasks/:taskId` (labels already included in response)

---

## File Structure

| File                                               | Action   | Responsibility                                                                 |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `apps/web/src/utils/issueGroups.ts`                | Modify   | Add `hasImplementationReadyLabel()` helper + label-check in `derivePipeline()` |
| `apps/web/src/utils/__tests__/issueGroups.test.ts` | Modify   | Add tests for label-gated actionable state + update existing tests for clarity |
| `apps/web/src/pages/CodeTaskViewPageV2.tsx`        | Modify   | Add label-check to `isImplementable` derivation                                |

---

### Task 1: Add `hasImplementationReadyLabel` helper and gate pipeline actionable state

**Files:**
- Modify: `apps/web/src/utils/issueGroups.ts`
- Modify: `apps/web/src/utils/__tests__/issueGroups.test.ts`

**Context:** The `derivePipeline()` function currently inserts a synthetic `actionable` execution step when planning is completed. We need to also check that the Linear issue has either `ready-to-implement` or `code-task` (backward compat) label. A reusable `hasImplementationReadyLabel()` helper encapsulates this check (including the empty/undefined fallback) for reuse by both the pipeline derivation and the detail view page.

- [ ] **Step 1: Read existing tests and source to understand patterns**

Read: `apps/web/src/utils/__tests__/issueGroups.test.ts`
Read: `apps/web/src/utils/issueGroups.ts`

Note the existing `createMockTask()` helper at line 6 and the `findStep()` helper at line 27. Use these in new tests.

- [ ] **Step 2: Write failing tests for `hasImplementationReadyLabel` and label-gated actionable logic**

Add to the existing test file `apps/web/src/utils/__tests__/issueGroups.test.ts`. Import `hasImplementationReadyLabel` from `../issueGroups.js` alongside the existing imports.

```typescript
// --- Add to imports at top ---
import { groupByLinearIssue, sortIssueGroups, hasImplementationReadyLabel } from '../issueGroups.js';

// --- Add new describe block after existing tests ---

describe('hasImplementationReadyLabel', () => {
  it('returns true when ready-to-implement label exists', () => {
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'ready-to-implement' }])).toBe(true);
  });

  it('returns true when code-task label exists (backward compat)', () => {
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'code-task' }])).toBe(true);
  });

  it('returns true when labels is undefined (graceful fallback)', () => {
    expect(hasImplementationReadyLabel(undefined)).toBe(true);
  });

  it('returns true when labels is empty array (graceful fallback)', () => {
    expect(hasImplementationReadyLabel([])).toBe(true);
  });

  it('returns false when labels has items but neither ready-to-implement nor code-task', () => {
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'some-other-label' }])).toBe(false);
  });

  it('handles mixed labels with ready-to-implement present', () => {
    expect(hasImplementationReadyLabel([
      { id: 'l1', name: 'bug' },
      { id: 'l2', name: 'ready-to-implement' },
    ])).toBe(true);
  });

  it('normalizes label names (spaces, underscores, casing)', () => {
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'Ready To Implement' }])).toBe(true);
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'ready_to_implement' }])).toBe(true);
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'Code-Task' }])).toBe(true);
  });
});

describe('label-gated actionable state', () => {
  const linearIssueSkeleton = {
    identifier: 'INT-100',
    title: 'Test',
    state: { name: 'Todo', type: 'unstarted' },
    priority: 3,
    assignee: null,
    url: 'https://linear.app/test',
    commentCount: 0,
    lastCommentAt: null,
  };

  it('shows actionable when ready-to-implement label exists', () => {
    const task = createMockTask({
      id: 't1',
      linearIssueId: 'INT-100',
      agentType: 'planning',
      status: 'planned',
      linearIssue: {
        ...linearIssueSkeleton,
        labels: [{ id: 'l1', name: 'ready-to-implement' }],
      },
    });
    const groups = groupByLinearIssue([task]);
    expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('actionable');
  });

  it('shows actionable when code-task label exists (backward compat)', () => {
    const task = createMockTask({
      id: 't1',
      linearIssueId: 'INT-100',
      agentType: 'planning',
      status: 'planned',
      linearIssue: {
        ...linearIssueSkeleton,
        labels: [{ id: 'l1', name: 'code-task' }],
      },
    });
    const groups = groupByLinearIssue([task]);
    expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('actionable');
  });

  it('shows actionable when linearIssue is undefined (graceful fallback)', () => {
    const task = createMockTask({
      id: 't1',
      linearIssueId: 'INT-100',
      agentType: 'planning',
      status: 'planned',
    });
    const groups = groupByLinearIssue([task]);
    expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('actionable');
  });

  it('shows actionable when linearIssue has empty labels array (graceful fallback)', () => {
    const task = createMockTask({
      id: 't1',
      linearIssueId: 'INT-100',
      agentType: 'planning',
      status: 'planned',
      linearIssue: {
        ...linearIssueSkeleton,
        labels: [],
      },
    });
    const groups = groupByLinearIssue([task]);
    expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('actionable');
  });

  it('does NOT show actionable when linearIssue has labels but neither ready-to-implement nor code-task', () => {
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
    expect(findStep(groups[0]?.pipeline, 'execution')).toBeUndefined();
  });

  it('does NOT show actionable when linearIssue has only unclear label', () => {
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
    expect(findStep(groups[0]?.pipeline, 'execution')).toBeUndefined();
  });
});
```

**Note on existing tests:** The existing test `'derives execution step as actionable'` (line 85-94) does not set `linearIssue` on the mock task. After this change, that test exercises the **undefined fallback path** (labels unavailable → allow). This is intentional and correct — the test still passes, but its semantic meaning shifts from "always allow" to "allow via graceful fallback." The new `'shows actionable when linearIssue is undefined'` test explicitly documents this fallback. Similarly, the existing `'derives aggregateStatus needs-action'` test (line 192-201) now implicitly tests the fallback path.

- [ ] **Step 3: Run tests to verify the new tests fail**

Run: `cd /repo && pnpm vitest run apps/web/src/utils/__tests__/issueGroups.test.ts`
Expected: FAIL — `hasImplementationReadyLabel` is not exported, and the `'does NOT show actionable'` tests fail (current logic always shows actionable for planned tasks regardless of labels)

- [ ] **Step 4: Add `hasImplementationReadyLabel` helper and modify `derivePipeline()`**

In `apps/web/src/utils/issueGroups.ts`:

**Add import** at top of file:
```typescript
import { normalizeLabel } from '@intexuraos/common-core';
```

**Add exported helper** (after the existing `getAgentTypeLabel` function, before `deriveStepState`):
```typescript
/**
 * Checks if a task's Linear labels indicate it's ready for implementation.
 *
 * Returns true (show Implement button) when:
 * - `ready-to-implement` label exists (new gated behavior)
 * - `code-task` label exists (backward compat for pre-existing planned tasks)
 * - labels are undefined or empty (graceful fallback when Linear hydration fails or issue has no labels)
 *
 * Returns false (hide Implement button) when:
 * - labels array has items but contains neither `ready-to-implement` nor `code-task`
 */
export function hasImplementationReadyLabel(labels: { name: string }[] | undefined): boolean {
  if (labels === undefined || labels.length === 0) {
    return true;
  }
  return labels.some(
    (l) => normalizeLabel(l.name) === 'ready-to-implement' || normalizeLabel(l.name) === 'code-task'
  );
}
```

**Modify the actionable logic** in `derivePipeline()` (lines 112-127). Replace:

```typescript
  // Actionable logic: if planning completed, no execution step exists, and no implementationTaskId
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

With:

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

- [ ] **Step 5: Run tests to verify they all pass**

Run: `cd /repo && pnpm vitest run apps/web/src/utils/__tests__/issueGroups.test.ts`
Expected: ALL PASS (including existing tests which now exercise the fallback path)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/utils/issueGroups.ts apps/web/src/utils/__tests__/issueGroups.test.ts
git commit -m "feat(web): gate pipeline actionable state on ready-to-implement label"
```

---

### Task 2: Gate detail view `isImplementable` on label

**Files:**
- Modify: `apps/web/src/pages/CodeTaskViewPageV2.tsx`

- [ ] **Step 1: Read the current `isImplementable` logic**

Read: `apps/web/src/pages/CodeTaskViewPageV2.tsx:120-130`

Current logic (line 123-125):
```typescript
const isImplementable = task.status === 'planned' &&
  task.implementationTaskId === undefined &&
  task.linearIssueId !== undefined;
```

- [ ] **Step 2: Update `isImplementable` to include label check**

Import `hasImplementationReadyLabel` from `@/utils/issueGroups.js` at the top of the file:
```typescript
import { hasImplementationReadyLabel } from '@/utils/issueGroups.js';
```

Replace the `isImplementable` derivation (line 123-125):

```typescript
const isImplementable = task.status === 'planned' &&
  task.implementationTaskId === undefined &&
  task.linearIssueId !== undefined &&
  hasImplementationReadyLabel(task.linearIssue?.labels);
```

This reuses the same helper, ensuring identical backward-compat logic across both UI entry points.

- [ ] **Step 3: Verify the build compiles**

Run: `cd /repo && pnpm --filter web build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/CodeTaskViewPageV2.tsx
git commit -m "feat(web): gate detail view Implement button on ready-to-implement label"
```

---

### Task 3: Verify end-to-end and run CI

- [ ] **Step 1: Run the full CI suite**

Run: `cd /repo && pnpm run ci:tracked`
Expected: ALL PASS

- [ ] **Step 2: Final commit if any fixups needed**

If CI revealed issues, fix and commit.

---

## Future Work: "Merge" Button (Not in scope)

When the review process ("Need Pick New Car") determines a PR needs no more changes (last run introduced zero modifications), it should:

1. Add the `ready-to-merge` label to the Linear issue
2. The web UI will show a "Merge" button when this label is present

### Architectural extension points:

**Helper function** (`apps/web/src/utils/issueGroups.ts`) — add alongside `hasImplementationReadyLabel`:
```typescript
export function hasMergeReadyLabel(labels: { name: string }[] | undefined): boolean {
  if (labels === undefined || labels.length === 0) {
    return false; // No fallback for merge — require explicit label
  }
  return labels.some((l) => normalizeLabel(l.name) === 'ready-to-merge');
}
```

**Pipeline visualization** (`apps/web/src/utils/issueGroups.ts`):
- Add a new `StepState` value (e.g., `'mergeable'`) or reuse `actionable` with a different `agentType`
- Gate on `ready-to-merge` label

**Detail view** (`apps/web/src/pages/CodeTaskViewPageV2.tsx`):
- Add `isMergeable` derivation checking via `hasMergeReadyLabel(task.linearIssue?.labels)`
- Render "Merge" button with appropriate UI

**Backend integration** (`apps/code-agent/src/routes/webhookRoutes.ts`):
- In the review callback handler, detect when a review run completed with no code changes
- Add `ready-to-merge` label via `linearAgentClient.updateIssueMetadata()`

**Label package** (`packages/common-core/src/labels.ts`) — add when backend needs it:
```typescript
export function hasReadyToImplementLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'ready-to-implement');
}
export function hasReadyToMergeLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'ready-to-merge');
}
```

### Label lifecycle:
```
Planning completes → (review runs) → ready-to-implement added → user clicks Implement
→ execution runs → PR created → (review runs) → ready-to-merge added → user clicks Merge
```
