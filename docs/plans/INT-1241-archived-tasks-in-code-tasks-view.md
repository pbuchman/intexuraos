# Archived Tasks in Code Tasks View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable viewing archived code tasks in the Code Tasks view via a mutually exclusive "Archived" filter, without degrading current performance.

**Architecture:** The current group summary system (`task_group_summaries` collection) only tracks non-archived groups — when all tasks in a group are archived, the summary doc is deleted and counts decremented. To support archived viewing, we introduce `'archived'` as a new `GroupStatus` value. The backend gets a new `aggregateStatus: 'archived'` for fully-archived groups. The frontend adds an "Archived" filter pill with mutual exclusivity: selecting "Archived" deselects all others and vice versa. This keeps the default (non-archived) path identical to today with zero performance impact.

**Tech Stack:** TypeScript, Firestore, Fastify (backend), React + TailwindCSS (frontend)

---

## Data-Driven Decision

Firestore benchmarks on production data (1,720 total tasks, 1,674 archived, 45 non-archived):

| Query                       | Latency   | Docs   | Payload   |
| --------------------------- | --------- | ------ | --------- |
| User non-archived (current) | ~200ms    | 45     | 227 KB    |
| User all tasks              | ~2,900ms  | 1,720  | 7.7 MB    |
| User archived only          | ~2,800ms  | 1,674  | 7.5 MB    |

**Conclusion:** 15x performance degradation when including archived tasks. **Flow 2** (mutually exclusive status filters) is required. Archived tasks MUST be fetched separately, never combined with non-archived queries.

## Design

### Key Decisions

1. **Mutual exclusivity:** "Archived" filter is mutually exclusive with all other filters (active, needs-action, done, failed). Selecting archived deselects the others; selecting any other deselects archived.
2. **Group summary lifecycle change:** Currently, when all tasks in a group become archived, the summary doc is deleted. The new behavior preserves the summary with `aggregateStatus: 'archived'` instead of deleting it.
3. **Separate count tracking:** `UserGroupCounts` gets a new `archived` field so the badge count is precomputed (no extra queries).
4. **No Firestore index changes needed:** The `listGroupSummaries` query uses `aggregateStatus` in an `in` filter — adding `'archived'` as a value works with existing indexes.

### Endpoint Changes

**Modified:**
- `GET /code/issue-groups` — accepts `'archived'` as a valid `groupStatus` filter value; response `counts` object includes `archived: number`

**Created:** None
**Removed:** None
**Unchanged:** `POST /code/tasks/:taskId/archive`

---

## Task 1: Extend GroupStatus Type to Include 'archived'

**Files:**
- Modify: `apps/code-agent/src/domain/issueGrouping/types.ts:6`
- Modify: `apps/web/src/types/issueGroups.ts:9`

- [ ] **Step 1: Update backend GroupStatus type**

In `apps/code-agent/src/domain/issueGrouping/types.ts`, change line 6:

```typescript
// Before
export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed';

// After
export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed' | 'archived';
```

- [ ] **Step 2: Update frontend GroupStatus type**

In `apps/web/src/types/issueGroups.ts`, change line 9:

```typescript
// Before
export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed';

// After
export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed' | 'archived';
```

- [ ] **Step 3: Update frontend ListIssueGroupsResponse counts type**

In `apps/web/src/types/issueGroups.ts`, the `counts` field is `Record<GroupStatus, number>` which will automatically include `archived` after the type change. Verify no explicit literal type overrides exist.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/types.ts apps/web/src/types/issueGroups.ts
git commit -m "feat(INT-1241): extend GroupStatus type with 'archived'"
```

---

## Task 2: Update UserGroupCounts Model and Default Counts

**Files:**
- Modify: `apps/code-agent/src/domain/models/taskGroupSummary.ts:53-61`
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts` (defaultCounts function, docToCounts function)
- Test: existing test file for group summary repository

- [ ] **Step 1: Add `archived` field to UserGroupCounts interface**

In `apps/code-agent/src/domain/models/taskGroupSummary.ts`:

```typescript
// Before
export interface UserGroupCounts {
  userId: string;
  active: number;
  needsAction: number;
  done: number;
  failed: number;
  totalGroups: number;
  updatedAt: Timestamp;
}

// After
export interface UserGroupCounts {
  userId: string;
  active: number;
  needsAction: number;
  done: number;
  failed: number;
  archived: number;
  totalGroups: number;
  updatedAt: Timestamp;
}
```

- [ ] **Step 2: Update `defaultCounts` helper**

In `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts`, find the `defaultCounts` function and add `archived: 0`:

```typescript
function defaultCounts(userId: string): UserGroupCounts {
  return {
    userId,
    active: 0,
    needsAction: 0,
    done: 0,
    failed: 0,
    archived: 0,
    totalGroups: 0,
    updatedAt: Timestamp.now(),
  };
}
```

- [ ] **Step 3: Update `docToCounts` to read `archived` field**

In the same file, find `docToCounts` and add:

```typescript
archived: Number(data['archived'] ?? 0),
```

- [ ] **Step 4: Update delta functions**

Find `applyNewGroupDelta`, `applyDeleteGroupDelta`, and `applyStatusChangeDelta`. Each must handle the `'archived'` status. For example in `applyNewGroupDelta`:

```typescript
// When newStatus is 'archived', increment archived count
case 'archived':
  result.archived = (result.archived ?? 0) + 1;
  break;
```

And in `applyStatusChangeDelta`, handle transitioning from/to `'archived'`.

- [ ] **Step 5: Write failing tests for the new `archived` count field**

Add tests that:
- Verify `getUserGroupCounts` returns `archived: 0` when no archived groups exist.
- Verify the `archived` count increments when a group transitions to `aggregateStatus: 'archived'`.
- Verify `totalGroups` includes archived groups.

- [ ] **Step 6: Run tests to confirm they fail, then implement and re-run**

```bash
cd apps/code-agent && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/models/taskGroupSummary.ts apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts
git commit -m "feat(INT-1241): add archived count to UserGroupCounts"
```

---

## Task 3: Preserve Group Summary When All Tasks Archived (Instead of Deleting)

**Files:**
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts` (`updateAfterStatusChange` method, around line 458-467)
- Test: existing group summary repository test file

This is the critical behavioral change. Currently, when `taskCount` reaches 0 (all tasks archived), the summary doc is **deleted** and counts decremented. The new behavior:
- Set `aggregateStatus` to `'archived'` instead of deleting the doc.
- Update user counts: decrement old status, increment `archived`.
- Keep `taskCount` at 0 (or set to the archived task count for display purposes — decided below).

**Design note:** `taskCount` should track non-archived tasks (stays at 0). The frontend can infer "all archived" from `aggregateStatus === 'archived'`.

- [ ] **Step 1: Write failing test for archive-preserves-summary behavior**

Write a test that:
1. Creates a group with one task.
2. Archives the task (status → 'archived').
3. Asserts the summary doc **still exists** with `aggregateStatus: 'archived'`.
4. Asserts user counts have `archived: 1` and the previous status count is decremented.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/code-agent && pnpm test -- --grep "archive"
```

Expected: FAIL because current code deletes the summary doc.

- [ ] **Step 3: Modify `updateAfterStatusChange` to preserve archived groups**

In `taskGroupSummaryFirestoreRepository.ts`, find the block at approximately line 458-467:

```typescript
// CURRENT CODE (around line 461-467):
if (newTask.status === 'archived' && oldTask.status !== 'archived') {
  updated.taskCount = Math.max(0, current.taskCount - 1);

  if (updated.taskCount <= 0) {
    // Delete summary doc and update user counts
    tx.delete(asDocRef(summaryRef));
    const newCounts = applyDeleteGroupDelta(existingCounts, oldAggregateStatus);
    // ...
  }
}

// NEW CODE:
if (newTask.status === 'archived' && oldTask.status !== 'archived') {
  updated.taskCount = Math.max(0, current.taskCount - 1);

  if (updated.taskCount <= 0) {
    // All tasks archived — preserve summary with 'archived' status
    updated.aggregateStatus = 'archived';
    tx.set(asDocRef(summaryRef), updated as unknown as DocumentData);
    const newCounts = applyStatusChangeDelta(existingCounts, oldAggregateStatus, 'archived');
    newCounts.userId = newTask.userId;
    newCounts.updatedAt = now;
    tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
    return;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/code-agent && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(INT-1241): preserve group summary when all tasks archived"
```

---

## Task 4: Update Issue Groups Route to Accept 'archived' Filter

**Files:**
- Modify: `apps/code-agent/src/routes/code/issueGroupRoutes.ts:27` (VALID_GROUP_STATUSES set)
- Modify: `apps/code-agent/src/routes/code/issueGroupRoutes.ts:324-333` (response counts)
- Test: existing route tests

- [ ] **Step 1: Write failing test for archived filter support**

Write a route test that:
1. Calls `GET /code/issue-groups?groupStatus=archived`.
2. Asserts the request succeeds (200).
3. Asserts the response `counts` object includes an `archived` field.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL because `'archived'` is not in `VALID_GROUP_STATUSES`.

- [ ] **Step 3: Add 'archived' to VALID_GROUP_STATUSES**

In `apps/code-agent/src/routes/code/issueGroupRoutes.ts`, line 27:

```typescript
// Before
const VALID_GROUP_STATUSES: ReadonlySet<string> = new Set(['active', 'needs-action', 'done', 'failed']);

// After
const VALID_GROUP_STATUSES: ReadonlySet<string> = new Set(['active', 'needs-action', 'done', 'failed', 'archived']);
```

- [ ] **Step 4: Update response counts to include `archived`**

In the same file, find the response object (around line 324-333):

```typescript
// Before
counts: {
  active: countsValue.active,
  'needs-action': countsValue.needsAction,
  done: countsValue.done,
  failed: countsValue.failed,
},

// After
counts: {
  active: countsValue.active,
  'needs-action': countsValue.needsAction,
  done: countsValue.done,
  failed: countsValue.failed,
  archived: countsValue.archived,
},
```

- [ ] **Step 5: Update totalGroups computation to include archived when filtered**

In the `statusFilter` block (around line 305-314), add the `archived` mapping:

```typescript
const countMap: Record<string, number> = {
  active: countsValue.active,
  'needs-action': countsValue.needsAction,
  done: countsValue.done,
  failed: countsValue.failed,
  archived: countsValue.archived,
};
```

- [ ] **Step 6: Handle archived task fetching in the task hydration loop**

When the `statusFilter` contains `'archived'`, the task fetch for each group must **include** archived tasks instead of excluding them. Modify the `filter` at line 233:

```typescript
// Before
return tasksResult.value
  .filter((t) => t.userId === userId && t.status !== 'archived')
  .map((t) => taskToSerializedTask(t));

// After
const includeArchived = statusFilter !== undefined && statusFilter.includes('archived');
return tasksResult.value
  .filter((t) => t.userId === userId && (includeArchived || t.status !== 'archived'))
  .map((t) => taskToSerializedTask(t));
```

Note: The `includeArchived` variable needs to be derived from the parsed `statusFilter` and passed into the task fetch section. Hoist `statusFilter` to be available before the task fetch promises (it already is — it's parsed at line 184).

Similarly update the standalone task check at line 244:

```typescript
// Before
if (task.userId !== userId || task.status === 'archived') {
  return [];
}

// After
if (task.userId !== userId || (!includeArchived && task.status === 'archived')) {
  return [];
}
```

- [ ] **Step 7: Run all tests**

```bash
cd apps/code-agent && pnpm test
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(INT-1241): accept 'archived' group status filter in issue-groups route"
```

---

## Task 5: Frontend — Mutually Exclusive Archived Filter

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`
- Modify: `apps/web/src/services/issueGroupsApi.ts` (if counts type needs updating)

- [ ] **Step 1: Add 'archived' to the status config and filter constants**

In `apps/web/src/pages/CodeTasksPage.tsx`:

```typescript
// Add archived to the status config (after the existing entries around line 20-41):
const GROUP_STATUS_CONFIG: Record<GroupStatus, { label: string; dotClass: string; activeClass: string }> = {
  active: {
    label: 'Active',
    dotClass: 'bg-blue-500',
    activeClass: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  },
  'needs-action': {
    label: 'Needs Action',
    dotClass: 'bg-green-500',
    activeClass: 'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400',
  },
  done: {
    label: 'Done',
    dotClass: 'bg-emerald-500',
    activeClass: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  failed: {
    label: 'Failed',
    dotClass: 'bg-red-500',
    activeClass: 'border-red-500 bg-red-50 text-red-700 dark:border-red-400 dark:bg-red-900/30 dark:text-red-400',
  },
  archived: {
    label: 'Archived',
    dotClass: 'bg-slate-400',
    activeClass: 'border-slate-400 bg-slate-50 text-slate-600 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-300',
  },
};
```

- [ ] **Step 2: Define non-archived and archived status sets**

```typescript
// Replace the existing ALL_GROUP_STATUSES (line 18):
const NON_ARCHIVED_STATUSES: GroupStatus[] = ['active', 'needs-action', 'done', 'failed'];
const ALL_GROUP_STATUSES: GroupStatus[] = [...NON_ARCHIVED_STATUSES, 'archived'];

// Keep default filters as non-archived only:
const DEFAULT_FILTERS: GroupStatus[] = NON_ARCHIVED_STATUSES;
```

- [ ] **Step 3: Implement mutual exclusivity in handleToggleFilter**

Replace the `handleToggleFilter` callback (around line 303-315):

```typescript
const handleToggleFilter = useCallback((status: GroupStatus): void => {
  setActiveFilters((prev) => {
    let next: GroupStatus[];

    if (status === 'archived') {
      // If archived is already selected, deselect it and show all non-archived
      if (prev.includes('archived')) {
        next = NON_ARCHIVED_STATUSES;
      } else {
        // Select only archived
        next = ['archived'];
      }
    } else {
      // Non-archived status toggled — ensure archived is removed
      const withoutArchived = prev.filter((s) => s !== 'archived');
      const set = new Set(withoutArchived);
      if (set.has(status)) {
        set.delete(status);
      } else {
        set.add(status);
      }
      next = [...set];
      // If all deselected, fall back to all non-archived
      if (next.length === 0) {
        next = NON_ARCHIVED_STATUSES;
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  });
}, []);
```

- [ ] **Step 4: Hide batch archive bar and selection checkboxes when viewing archived**

The batch archive functionality doesn't make sense when viewing already-archived groups. In the component, gate the archive eligibility:

```typescript
// Update isArchiveEligible to return false when in archived view
const isViewingArchived = activeFilters.length === 1 && activeFilters[0] === 'archived';

// In the JSX, wrap the batch selection summary:
{!isViewingArchived && eligibleGroups.length > 0 ? (
  // ... existing batch selection UI
) : null}
```

Also pass `isSelectable={selectable && !isViewingArchived}` to `IssueGroupRow`.

- [ ] **Step 5: Update the "Clear filters" button to reset to non-archived defaults**

The existing clear filters button (line 486-494) already resets to `DEFAULT_FILTERS` which will be `NON_ARCHIVED_STATUSES`. No change needed, but verify.

- [ ] **Step 6: Add visual separator before the Archived pill**

To visually distinguish the mutually exclusive archived filter, add a thin separator in the `StatusPipeline` component:

```typescript
function StatusPipeline({ counts, activeFilters, onToggle }: StatusPipelineProps): React.JSX.Element {
  const activeSet = useMemo(() => new Set(activeFilters), [activeFilters]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {NON_ARCHIVED_STATUSES.map((status) => {
        const cfg = GROUP_STATUS_CONFIG[status];
        const count = counts[status];
        const isActive = activeSet.has(status);

        return (
          <button
            key={status}
            onClick={(): void => { onToggle(status); }}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              isActive ? cfg.activeClass : INACTIVE_SEGMENT_CLASS
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${cfg.dotClass}`} />
            {cfg.label}
            <span className="font-medium">{String(count)}</span>
          </button>
        );
      })}
      {/* Separator before archived */}
      <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />
      {(() => {
        const cfg = GROUP_STATUS_CONFIG.archived;
        const count = counts.archived;
        const isActive = activeSet.has('archived');
        return (
          <button
            onClick={(): void => { onToggle('archived'); }}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              isActive ? cfg.activeClass : INACTIVE_SEGMENT_CLASS
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${cfg.dotClass}`} />
            {cfg.label}
            <span className="font-medium">{String(count)}</span>
          </button>
        );
      })()}
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(INT-1241): add mutually exclusive archived filter to code tasks UI"
```

---

## Task 6: Backfill Existing Archived Groups

**Files:**
- Create: `scripts/backfill-archived-group-summaries.ts` (one-time script)

Existing archived groups had their summary docs **deleted**. A backfill is needed to recreate them with `aggregateStatus: 'archived'`.

- [ ] **Step 1: Write the backfill script**

```typescript
/**
 * One-time backfill: recreate group summaries for fully-archived task groups.
 *
 * Logic:
 * 1. Query all code_tasks with status === 'archived'.
 * 2. Group by (userId, linearIssueId || `standalone_${taskId}`).
 * 3. For each group, check if a task_group_summaries doc exists.
 * 4. If not, check if ANY non-archived task exists for that group.
 * 5. If no non-archived tasks exist, create a summary with aggregateStatus: 'archived'.
 * 6. Increment user_group_counts.archived for each created summary.
 */
```

- [ ] **Step 2: Test the backfill script locally against the dev Firestore**

```bash
npx tsx scripts/backfill-archived-group-summaries.ts --dry-run
```

Verify it identifies the expected number of groups to create.

- [ ] **Step 3: Run the backfill (non-dry-run)**

```bash
npx tsx scripts/backfill-archived-group-summaries.ts
```

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-archived-group-summaries.ts
git commit -m "feat(INT-1241): add backfill script for archived group summaries"
```

---

## Task 7: End-to-End Verification

- [ ] **Step 1: Run full CI**

```bash
pnpm run ci:tracked
```

- [ ] **Step 2: Verify backend behavior manually**

Test the following scenarios:
1. `GET /code/issue-groups` (no filter) — should NOT return archived groups (backwards compatible).
2. `GET /code/issue-groups?groupStatus=archived` — should return only archived groups.
3. `GET /code/issue-groups?groupStatus=active,failed` — should return active and failed, no archived.
4. Response `counts` includes `archived: N` in all cases.

- [ ] **Step 3: Verify frontend behavior**

1. Default view shows active, needs-action, done, failed filters (all selected).
2. Clicking "Archived" deselects all others, shows only archived groups.
3. Clicking any non-archived filter while "Archived" is active deselects archived.
4. Badge count for "Archived" shows correct number.
5. Batch archive UI is hidden when viewing archived groups.

- [ ] **Step 4: Commit any fixes**

```bash
git commit -m "fix(INT-1241): address e2e verification findings"
```
