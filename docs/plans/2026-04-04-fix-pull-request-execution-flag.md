# Fix Code Button Showing on Groups That Don't Appear in "Needs Action" Filter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the UI inconsistency where a group's "Code" (implement) button renders even when the group's `aggregateStatus` is `active`, causing user confusion because the group appears under the "Active" filter rather than "Needs Action".

**Architecture:** The `aggregateStatus` and pipeline are computed **entirely client-side** in `apps/web/src/utils/issueGroups.ts`. There is no server-side precomputed summary — the web app fetches raw `code_tasks` from the API, groups them by `linearIssueId`, and derives pipeline steps + aggregate status on-the-fly via `derivePipeline()` and `deriveAggregateStatus()`. The "Code" button is rendered in `apps/web/src/components/code-tasks/IssueGroupRow.tsx` based on the presence of an `actionable` pipeline step.

**Tech Stack:** TypeScript, React, Vitest

---

## Root Cause

The rendering function `renderActionButton` in `IssueGroupRow.tsx` (line ~226) checks for an actionable pipeline step **before** checking `aggregateStatus`:

```typescript
function renderActionButton(compact: boolean): React.JSX.Element | null {
  if (isActioning) return <WaveLoader />;
  if (hasMergeAction && pipeline.pr !== null) { /* merge link */ }
  if (hasImplementAction) { /* Code button ← rendered here */ }
  if (pipeline.pr !== null) { /* PR link */ }
  if (aggregateStatus === 'failed') { /* Retry button */ }
  if (aggregateStatus === 'active') return <WaveLoader />;  // ← never reached if hasImplementAction
  return null;
}
```

Meanwhile, `deriveAggregateStatus()` in `issueGroups.ts` (line ~287) checks for **active tasks before actionable steps**:

```typescript
function deriveAggregateStatus(tasks, pipeline): GroupStatus {
  if (hasActive) return 'active';          // ← active takes priority
  if (pipeline.steps.some(s => s.state === 'actionable')) return 'needs-action';
  // ...
}
```

**The conflict:** When a group has BOTH an active task (running/dispatched/queued) AND a planning-completed step with no execution agent, the pipeline contains a synthetic actionable `execution` step AND `aggregateStatus` is `active`. The `renderActionButton` renders the Code button (because `hasImplementAction` is checked first), but the group sits in the "Active" filter — not "Needs Action".

**The same bug affects the Merge button:** If execution completed with a PR and `ready-to-merge` label, but review is still running, the pipeline has an actionable `merge` step while `aggregateStatus` is `active`. The `hasMergeAction` check (line ~229) fires before the `active` check (line ~285), rendering a Merge button on a group in the "Active" filter. The fix must guard both action buttons.

**INT-1255 scenario:** Tasks are `[planning(planned), review(...), remediation(...), pull_request(implemented)]`. If the review or remediation task was still active (running/dispatched/queued) at the time of observation, while planning had completed and no `execution` agent task existed, the pipeline would show an actionable execution step (Code button), but `aggregateStatus` would be `active`.

## Evidence

1. **Client-side computation only:** `Grep('aggregateStatus', '/repo')` shows all computation in `apps/web/src/utils/issueGroups.ts` — no backend derivation or Firestore summary collections exist.
2. **No `task_group_summaries` collection:** `firestore-collections.json` has no entry for `task_group_summaries` or `user_group_counts`.
3. **Rendering precedence visible in code:** `IssueGroupRow.tsx` line ~243 (`hasImplementAction`) executes before line ~285 (`aggregateStatus === 'active'`).
4. **`derivePipeline` inserts actionable step independently of active status:** Lines 215-228 in `issueGroups.ts` insert a synthetic actionable `execution` step based solely on planning completion, regardless of whether other tasks are active.

## File Structure

| File                                                   | Action   | Responsibility                                                                                       |
| ------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/code-tasks/IssueGroupRow.tsx` | Modify   | Guard Code and Merge buttons with `aggregateStatus !== 'active'`; preserve PR link for active groups |
| `apps/web/src/utils/__tests__/issueGroups.test.ts`     | Modify   | Add regression tests: group with actionable step AND active task → `aggregateStatus` is `active`     |

---

### Task 1: Add regression test for the precedence scenario

**Files:**
- Modify: `apps/web/src/utils/__tests__/issueGroups.test.ts`

This test proves the existing `deriveAggregateStatus` behavior is correct (active > needs-action priority) and documents the scenario that confuses users.

- [ ] **Step 1: Write the test**

Add to the existing `groupByLinearIssue` describe block:

```typescript
it('group with actionable execution step AND active review task gets aggregateStatus active (not needs-action)', () => {
  const tasks = [
    createMockTask({
      id: 't1',
      linearIssueId: 'INT-1255',
      agentType: 'planning',
      status: 'planned',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:05:00Z',
    }),
    createMockTask({
      id: 't2',
      linearIssueId: 'INT-1255',
      agentType: 'review',
      status: 'running',
      createdAt: '2026-01-01T11:00:00Z',
      updatedAt: '2026-01-01T11:05:00Z',
    }),
  ];

  const groups = groupByLinearIssue(tasks);

  expect(groups).toHaveLength(1);
  // Pipeline DOES have an actionable execution step
  expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('actionable');
  // But aggregateStatus is 'active' because an active task takes priority
  expect(groups[0]?.aggregateStatus).toBe('active');
});

it('group with all terminal tasks and no execution agent → needs-action', () => {
  const tasks = [
    createMockTask({
      id: 't1',
      linearIssueId: 'INT-1255',
      agentType: 'planning',
      status: 'planned',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:05:00Z',
    }),
    createMockTask({
      id: 't2',
      linearIssueId: 'INT-1255',
      agentType: 'pull_request',
      status: 'implemented',
      createdAt: '2026-01-01T12:00:00Z',
      updatedAt: '2026-01-01T12:05:00Z',
    }),
    createMockTask({
      id: 't3',
      linearIssueId: 'INT-1255',
      agentType: 'review',
      status: 'reviewed',
      createdAt: '2026-01-01T11:00:00Z',
      updatedAt: '2026-01-01T11:05:00Z',
    }),
  ];

  const groups = groupByLinearIssue(tasks);

  expect(groups).toHaveLength(1);
  // No 'execution' agent task exists, so derivePipeline inserts a synthetic actionable step
  // (pull_request is a separate agent type — it doesn't satisfy the execution step check)
  expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('actionable');
  // With no active tasks, aggregateStatus correctly reflects the actionable step
  expect(groups[0]?.aggregateStatus).toBe('needs-action');
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run src/utils/__tests__/issueGroups.test.ts`
Expected: All tests pass (these document existing correct behavior).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/utils/__tests__/issueGroups.test.ts
git commit -m "test(web): add regression tests for active-vs-actionable status precedence (INT-1267)"
```

---

### Task 2: Fix `renderActionButton` to respect `aggregateStatus` priority

**Files:**
- Modify: `apps/web/src/components/code-tasks/IssueGroupRow.tsx` (line ~226)

The fix guards the **action buttons** (Code, Merge) with an `aggregateStatus !== 'active'` check, while preserving the informational PR link for active groups. A blanket early-return would suppress the PR link, losing useful context when a group is active but already has a PR.

- [ ] **Step 1: Fix `renderActionButton` in IssueGroupRow.tsx**

Guard the Merge and Code button branches so they don't render when the group is active. The PR link and the existing `active` WaveLoader fallback at the bottom remain unchanged:

```typescript
function renderActionButton(compact: boolean): React.JSX.Element | null {
  const px = compact ? 'px-2' : 'px-2.5';
  if (isActioning) return <WaveLoader compact={compact} />;
  if (hasMergeAction && pipeline.pr !== null && aggregateStatus !== 'active') {
    // ... merge link (unchanged)
  }
  if (hasImplementAction && aggregateStatus !== 'active') {
    // ... Code button (unchanged)
  }
  if (pipeline.pr !== null) {
    // ... PR link (unchanged — informational, always shown)
  }
  if (aggregateStatus === 'failed') {
    // ... Retry button (unchanged)
  }
  if (aggregateStatus === 'active') return <WaveLoader compact={compact} />;
  return null;
}
```

This ensures:
- Active groups with PR: show PR link (informational, not an action)
- Active groups without PR: show WaveLoader (consistent with "Active" filter placement)
- Needs-action groups: show Code or Merge button (consistent with "Needs Action" filter placement)
- Failed groups: show Retry button
- Done groups: show PR link or nothing

**Why not a blanket early return?** The PR link (`#{pipeline.pr.number}`) is informational — it tells the user "your group is busy, here's the PR it produced". Suppressing it during active state would lose useful context. Only the action buttons (Code, Merge) are misleading when the group is active.

- [ ] **Step 2: Verify the change doesn't break existing tests**

Run: `cd apps/web && pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/code-tasks/IssueGroupRow.tsx
git commit -m "fix(web): suppress Code button when group is active to match filter placement

The renderActionButton function checked for actionable steps before
aggregateStatus, causing the Code button to render on groups in the
Active filter. Users saw a Code button but the group wasn't in
Needs Action. Moving the active check first ensures WaveLoader
renders for active groups.

Fixes INT-1267"
```

---

### Task 3: Run full CI verification

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All tests pass.

---

## Why No Data Repair Script Is Needed

Unlike the original plan's proposal for a Firestore repair script, no data repair is needed because:

1. **`aggregateStatus` is not stored** — it is derived on-the-fly from task data every time the page renders.
2. **No `task_group_summaries` or `user_group_counts` collections exist** — the `firestore-collections.json` registry confirms this.
3. **The underlying task data in `code_tasks` collection is correct** — the issue is purely in the client-side rendering logic.

Once the `renderActionButton` fix is deployed, all groups will immediately display correctly without any database migration.

## Endpoint Changes

No endpoint changes. This fix is entirely in the web frontend.

- Modified: none
- Created: none
- Removed: none
- Unchanged: all existing endpoints
