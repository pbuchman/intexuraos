# Code Tasks List Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework CodeTasksPage from a flat task-centric card list to an issue-centric grouped table with visual pipelines, grouped by `linearIssueId`.

**Architecture:** Pure client-side grouping of the existing flat API response. A new `issueGroups.ts` utility handles grouping + pipeline derivation (pure function, unit-tested). `CodeTasksPage.tsx` is rewritten with `React.memo`'d `IssueGroupRow` components. `useCodeTasks` hook gets merge-based refresh for stable references. No backend changes.

**Tech Stack:** React 18, TypeScript strict mode, TailwindCSS, Vitest, Lucide icons

**Design doc:** `docs/plans/2026-03-07-code-tasks-list-redesign-design.md`

---

## Task 1: Types and Grouping Function — Failing Tests

**Files:**
- Create: `apps/web/src/utils/__tests__/issueGroups.test.ts`
- Create: `apps/web/src/utils/issueGroups.ts` (empty export for now)

**Step 1: Create the empty module so tests can import it**

Create `apps/web/src/utils/issueGroups.ts` with stub exports:

```typescript
import type { CodeTask } from '@/types';

export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed';
export type StepState = 'completed' | 'running' | 'failed' | 'waiting' | 'actionable';

export interface PipelineState {
  planning: StepState | null;
  execution: StepState | null;
  pr: { url: string; number: string } | null;
  failedAttempts: number;
  archivedCount: number;
}

export interface IssueGroup {
  linearIssueId: string | null;
  linearIssue: CodeTask['linearIssue'] | undefined;
  tasks: CodeTask[];
  pipeline: PipelineState;
  latestTask: CodeTask;
  aggregateStatus: GroupStatus;
}

export function groupByLinearIssue(_tasks: CodeTask[]): IssueGroup[] {
  return [];
}
```

**Step 2: Write failing tests for grouping**

Create `apps/web/src/utils/__tests__/issueGroups.test.ts` with a `createMockTask` factory and the following test cases. Every test should fail because `groupByLinearIssue` returns `[]`.

Test cases to write (each as a separate `it()` block inside a `describe('groupByLinearIssue', ...)`):

1. **groups tasks by linearIssueId** — 3 tasks, 2 share `INT-100`, 1 has `INT-200`. Expect 2 groups.
2. **tasks without linearIssueId get individual groups** — 2 tasks with no `linearIssueId`. Expect 2 groups (keyed by task ID).
3. **derives planning step as completed** — group with one planning task, status `planned`. Expect `pipeline.planning === 'completed'`.
4. **derives execution step as completed** — group with one execution task, status `implemented`. Expect `pipeline.execution === 'completed'`.
5. **derives execution step as actionable** — planning task with status `planned`, no `implementationTaskId`. Expect `pipeline.execution === 'actionable'`.
6. **derives execution step as running** — execution task with status `running`. Expect `pipeline.execution === 'running'`.
7. **derives execution step as failed with attempt count** — 2 execution tasks, both `failed`, one `archived`. Expect `pipeline.failedAttempts === 1`, `pipeline.archivedCount === 1`.
8. **derives PR step** — execution task with `result.prUrl = 'https://github.com/org/repo/pull/42'`. Expect `pipeline.pr === { url: '...', number: '42' }`.
9. **derives aggregateStatus active** — task with status `running`. Expect `aggregateStatus === 'active'`.
10. **derives aggregateStatus needs-action** — planning task `planned`, no `implementationTaskId`. Expect `'needs-action'`.
11. **derives aggregateStatus failed** — latest non-archived task is `failed`. Expect `'failed'`.
12. **derives aggregateStatus done** — all terminal, none failed. Expect `'done'`.
13. **sorts groups: active, needs-action, failed, done** — 4 groups, one of each. Expect this order.
14. **sorts within same status by latestTask.updatedAt desc** — 2 `done` groups with different timestamps. Newest first.
15. **excludes archived tasks from latest planning/execution lookup** — group with archived planning + non-archived planning. Expect pipeline uses the non-archived one.

The `createMockTask` factory:

```typescript
import type { CodeTask } from '@/types';

function createMockTask(overrides: Partial<CodeTask> & { id: string }): CodeTask {
  return {
    id: overrides.id,
    userId: 'user-1',
    prompt: 'test prompt',
    sanitizedPrompt: overrides.sanitizedPrompt ?? 'test prompt',
    systemPromptHash: 'hash',
    workerType: overrides.workerType ?? 'opus',
    workerLocation: overrides.workerLocation ?? 'Home-Dev',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-1',
    status: overrides.status ?? 'planned',
    dedupKey: 'dedup-1',
    callbackReceived: false,
    createdAt: overrides.createdAt ?? '2026-03-07T15:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-07T15:05:00Z',
    ...overrides,
  };
}
```

**Step 3: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- src/utils/__tests__/issueGroups.test.ts`
Expected: All 15 tests FAIL (groupByLinearIssue returns empty array)

**Step 4: Commit**

```
git add apps/web/src/utils/issueGroups.ts apps/web/src/utils/__tests__/issueGroups.test.ts
git commit -m "test: add failing tests for issue group utility"
```

---

## Task 2: Implement groupByLinearIssue

**Files:**
- Modify: `apps/web/src/utils/issueGroups.ts`

**Step 1: Implement the grouping function**

Replace the stub `groupByLinearIssue` with the full implementation following the design doc algorithm:

1. Group tasks into `Map<string, CodeTask[]>` by `linearIssueId`. Tasks without `linearIssueId` use task `id` as key, `linearIssueId` stored as `null`.
2. For each group:
   - Sort tasks by `updatedAt` desc
   - Find latest non-archived planning task (`agentType === 'planning'`)
   - Find latest non-archived execution task (`agentType === 'execution'`)
   - Derive `PipelineState`:
     - `planning`: `null` if no planning task. `'completed'` if status is `planned`/`implemented`. `'running'` if `running`/`dispatched`/`queued`. `'failed'` if `failed`/`interrupted`.
     - `execution`: `null` if no execution task AND no actionable state. `'actionable'` if planning is completed and no `implementationTaskId` on the planning task. `'completed'` if `implemented`. `'running'` if `running`/`dispatched`/`queued`. `'failed'` if `failed`/`interrupted`.
     - `pr`: Extract from any task's `result?.prUrl` using regex `/\/pull\/(\d+)/`. `null` if no PR.
     - `failedAttempts`: count of tasks with `status === 'failed'` and `status !== 'archived'`
     - `archivedCount`: count of tasks with `status === 'archived'`
   - Derive `aggregateStatus`: check in priority order — `'active'` > `'needs-action'` > `'failed'` > `'done'`
   - Set `latestTask` to `tasks[0]` (already sorted by `updatedAt` desc)
   - Set `linearIssue` from any task in group that has it
3. Sort groups by `aggregateStatus` priority, then `latestTask.updatedAt` desc within same status.

**Step 2: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- src/utils/__tests__/issueGroups.test.ts`
Expected: All 15 tests PASS

**Step 3: Commit**

```
git add apps/web/src/utils/issueGroups.ts
git commit -m "feat: implement groupByLinearIssue utility for issue-centric grouping"
```

---

## Task 3: Merge-Based Refresh in useCodeTasks

**Files:**
- Modify: `apps/web/src/hooks/useCodeTasks.ts`

**Step 1: Add limit: 50 to both fetch calls**

In the `refresh` function (~line 52), change:
```typescript
const listOptions = options?.status !== undefined && options.status.length > 0 ? { status: options.status } : {};
```
to:
```typescript
const listOptions: { status?: CodeTaskStatus[]; limit: number } = { limit: 50 };
if (options?.status !== undefined && options.status.length > 0) {
  listOptions.status = options.status;
}
```

In the `loadMore` function (~line 104), add `limit: 50` to `loadMoreOptions`:
```typescript
const loadMoreOptions: { status?: CodeTaskStatus[]; cursor?: string; limit: number } = { limit: 50 };
```

**Step 2: Replace setTasks(data.tasks) with merge function**

Add a `mergeTasks` helper inside the hook (or as a module-level function):

```typescript
function mergeTasks(prev: CodeTask[], incoming: CodeTask[]): CodeTask[] {
  if (prev.length === 0) return incoming;
  const prevMap = new Map(prev.map((t) => [t.id, t]));
  let changed = prev.length !== incoming.length;
  const merged = incoming.map((t) => {
    const existing = prevMap.get(t.id);
    if (existing !== undefined && existing.status === t.status && existing.updatedAt === t.updatedAt) {
      return existing;
    }
    changed = true;
    return t;
  });
  return changed ? merged : prev;
}
```

Replace `setTasks(data.tasks)` in `refresh` (~line 55) with:
```typescript
setTasks((prev) => mergeTasks(prev, data.tasks));
```

Keep the `loadMore` path using append: `setTasks((prev) => [...prev, ...data.tasks])` — this is correct since it adds new pages.

**Step 3: Run existing app verification**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds with no type errors

**Step 4: Commit**

```
git add apps/web/src/hooks/useCodeTasks.ts
git commit -m "feat: increase page size to 50 and add merge-based refresh for stable references"
```

---

## Task 4: Rewrite CodeTasksPage — StatusPipeline + PageHeader

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`

**Step 1: Replace the entire CodeTasksPage component**

Rewrite the file. Keep existing imports that are still needed (`Link`, `useNavigate`, `Button`, `Layout`, `useCodeTasks`, `useWorkersStatus`, `formatDateTime`). Add new imports:

```typescript
import { useMemo, useState, useCallback, memo } from 'react';
import { ChevronDown, ChevronRight, Plus, Play, RotateCcw, ExternalLink } from 'lucide-react';
import { groupByLinearIssue } from '@/utils/issueGroups';
import type { IssueGroup, GroupStatus } from '@/utils/issueGroups';
import { formatElapsedTime } from '@/utils/dateFormat';
import type { WorkerStatusTag } from '@/types';
```

Start with the page shell and the two top-level components:

**PageHeader:** Renders title, subtitle (with counts from `issueGroups`), and New Task button.

**StatusPipeline:** Renders the horizontal filter bar. State: `useState<Set<GroupStatus>>` initialized from `localStorage` key `code-tasks-group-filter`. Each segment is a clickable div with a colored dot, label, and count. Active segments are visually highlighted. Migration: if `code-tasks-group-filter` doesn't exist in localStorage, default to showing all except archived.

**CodeTasksPage body:**
```typescript
export function CodeTasksPage(): React.JSX.Element {
  const [activeFilters, setActiveFilters] = useState<Set<GroupStatus>>(() => {
    // ... load from localStorage with migration
  });
  const { tasks, loading, loadingMore, error, hasMore, loadMore, deleteTask } = useCodeTasks({
    // No status filter here — we fetch all non-archived and filter client-side by group status
  });
  const { status: workersStatus } = useWorkersStatus();

  const workerHealthMap = useMemo(
    () => new Map(workersStatus?.workers.map((w) => [w.name, w.status]) ?? []),
    [workersStatus]
  );

  const allGroups = useMemo(() => groupByLinearIssue(tasks), [tasks]);

  const filteredGroups = useMemo(
    () => activeFilters.size === 0 ? allGroups : allGroups.filter((g) => activeFilters.has(g.aggregateStatus)),
    [allGroups, activeFilters]
  );

  const counts = useMemo(() => {
    const c = { active: 0, 'needs-action': 0, done: 0, failed: 0 };
    for (const g of allGroups) { c[g.aggregateStatus]++; }
    return c;
  }, [allGroups]);

  // ... render PageHeader, StatusPipeline, ColumnHeader, IssueGroupList
}
```

**Important:** The `useCodeTasks` status filter should still pass the default visible statuses (all except archived) to the API to avoid fetching archived tasks unless the user enables the Archived filter. When Archived filter is toggled ON, include `'archived'` in the API status filter and re-fetch.

**Step 2: Verify build**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds (IssueGroupRow not yet implemented — use a placeholder `<div>` rendering `group.linearIssueId`)

**Step 3: Commit**

```
git add apps/web/src/pages/CodeTasksPage.tsx
git commit -m "feat: rewrite CodeTasksPage with issue grouping, status pipeline, and page header"
```

---

## Task 5: IssueGroupRow — Collapsed View

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`

**Step 1: Implement IssueGroupRow as a memo'd component**

Replace the placeholder from Task 4. The component receives:

```typescript
interface IssueGroupRowProps {
  group: IssueGroup;
  workerHealthMap: Map<string, WorkerStatusTag>;
  onAction: (taskId: string, action: 'delete' | 'retry' | 'implement') => void;
}
```

Wrap with `memo()` and custom comparator:

```typescript
const IssueGroupRow = memo(function IssueGroupRow({ group, workerHealthMap, onAction }: IssueGroupRowProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  // ...
}, (prev, next) => prev.group === next.group && prev.workerHealthMap === next.workerHealthMap && prev.onAction === next.onAction);
```

**Collapsed row layout** — a div with CSS grid `grid-template-columns: 200px 1fr 200px 140px 120px`:

- **Issue column:** `linearIssueId` as monospace blue link (or first 40 chars of `sanitizedPrompt` if no Linear issue). Title below (1-line clamp).
- **Pipeline column:** Render `PipelineStep` components connected by `PipelineConnector` divs. Each step has a dot + label based on `StepState`. Use the pipeline rendering rules table from the design doc.
- **Worker column:** Model tag (monospace, subtle border), location text, health dot from `workerHealthMap.get(latestTask.workerLocation)`.
- **Time column:** Relative time via `formatRelative(group.latestTask.updatedAt)`. Duration via `formatElapsedTime()`.
- **Output column:** Conditionally render:
  - `pipeline.execution === 'actionable'` → green "Implement" button
  - `pipeline.pr !== null` → blue PR link chip
  - `aggregateStatus === 'failed'` → "Retry" ghost button
  - `aggregateStatus === 'active'` → small spinner
  - Otherwise: empty

**Left border accent:** Use `box-shadow: inset 3px 0 0 <color>` based on `aggregateStatus`.

**Expand chevron:** Only visible when `group.tasks.length > 1`. Toggles `expanded` state with `stopPropagation`.

**Row click:** `navigate(`/code-tasks/${group.latestTask.id}`)`.

**Step 2: Implement onAction callback in CodeTasksPage**

```typescript
const handleAction = useCallback(
  (taskId: string, action: 'delete' | 'retry' | 'implement') => {
    if (action === 'delete') { void deleteTask(taskId); }
    // retry and implement can navigate to task view for now
    // (full action support is out of scope for list view)
  },
  [deleteTask]
);
```

**Step 3: Verify build**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```
git add apps/web/src/pages/CodeTasksPage.tsx
git commit -m "feat: implement IssueGroupRow with pipeline visualization and grid layout"
```

---

## Task 6: IssueTimeline — Expanded View

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`

**Step 1: Implement IssueTimeline component**

Rendered inside `IssueGroupRow` when `expanded === true` and `group.tasks.length > 1`.

```typescript
function IssueTimeline({ tasks }: { tasks: CodeTask[] }): React.JSX.Element
```

Layout: a div with `border-top`, background slightly darker than the row. Contains a vertical timeline (CSS `::before` pseudo-element for the line).

For each task in `tasks` (already sorted newest-first), render a timeline item:

- **Dot color:** green = `implemented`/`planned`, red = `failed`/`interrupted`, blue = `running`/`dispatched`/`queued`, violet = `planned` with `agentType === 'planning'`, slate = `archived`/`cancelled`
- **Action label:** Based on `agentType` + `status`:
  - `execution` + `implemented` → "Execution completed"
  - `execution` + `failed` → "Execution failed"
  - `execution` + `running` → "Execution running"
  - `planning` + `planned` → "Planning completed"
  - `planning` + `failed` → "Planning failed"
  - Archived tasks: label gets strikethrough styling
- **Chips:** Model chip (`workerType`) + worker location chip (only if different from `group.latestTask.workerLocation`)
- **Timestamp:** `formatDateTime(task.updatedAt)` + duration via `formatElapsedTime`
- **Detail line:**
  - If `result?.prUrl`: link to PR
  - If `error?.message`: error text in red
  - Otherwise: truncated `sanitizedPrompt` (60 chars)
- **followUpReason chip:** Only when set. `'retry'` = amber, `'pr_comment'` = blue, `'user_feedback'` = slate. Skip `'execution_implement'` (normal flow).

**Footer line:** Muted text: `"{n} tasks · {m} archived · click to collapse"` — clicking collapses.

**Step 2: Verify build**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds

**Step 3: Commit**

```
git add apps/web/src/pages/CodeTasksPage.tsx
git commit -m "feat: implement IssueTimeline expanded view with task history"
```

---

## Task 7: Filter Persistence + LocalStorage Migration

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`

**Step 1: Implement filter state initialization with migration**

In the `CodeTasksPage` component's `useState` initializer for `activeFilters`:

```typescript
const [activeFilters, setActiveFilters] = useState<Set<GroupStatus>>(() => {
  const newKey = 'code-tasks-group-filter';
  const stored = localStorage.getItem(newKey);
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        const valid: GroupStatus[] = ['active', 'needs-action', 'done', 'failed'];
        return new Set(parsed.filter((s): s is GroupStatus => valid.includes(s as GroupStatus)));
      }
    } catch { /* use default */ }
  }
  // Default: show all except archived (archived groups only shown when no filter = "show all")
  return new Set<GroupStatus>(['active', 'needs-action', 'done', 'failed']);
});
```

**Step 2: Implement filter toggle handler**

```typescript
const handleToggleFilter = useCallback((status: GroupStatus): void => {
  setActiveFilters((prev) => {
    const next = new Set(prev);
    if (next.has(status)) { next.delete(status); } else { next.add(status); }
    localStorage.setItem('code-tasks-group-filter', JSON.stringify([...next]));
    return next;
  });
}, []);
```

**Step 3: Handle archived filter interaction with API**

When the user toggles filters and ALL of `active, needs-action, done, failed` are unchecked (meaning only archived would show), the `useCodeTasks` hook should include `'archived'` in its status filter. Wire this by deriving the API status filter from the group filter state:

- If activeFilters contains all 4 non-archived statuses OR is empty: pass default visible statuses to API (no archived)
- If activeFilters is some subset that could include archived groups: pass all statuses including `'archived'`

This is a pragmatic simplification: always fetch archived when any non-default filter is active.

**Step 4: Verify build**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds

**Step 5: Commit**

```
git add apps/web/src/pages/CodeTasksPage.tsx
git commit -m "feat: add filter persistence and localStorage migration for group status filter"
```

---

## Task 8: Responsive Layout + Polish

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`

**Step 1: Add responsive breakpoints**

On small screens (`< 1100px`): reduce grid column widths.
On mobile (`< 800px`): stack columns vertically, hide ColumnHeader, show issue + pipeline on first row, worker + time + output on second row.

Use Tailwind responsive classes:
- Default grid: `grid grid-cols-[200px_1fr_200px_140px_120px]`
- `lg` breakpoint: `lg:grid-cols-[200px_1fr_200px_140px_120px]`
- Below `lg`: `grid-cols-[1fr]` with each cell as a flex row

**Step 2: Add loading state**

Keep the existing spinner pattern from the current page for initial load.

**Step 3: Add empty state**

When `filteredGroups.length === 0`:
- If filters are active: "No issues match the selected filters"
- If no tasks at all: "No code tasks yet" with link to create

**Step 4: Add error state**

Keep the existing red error banner pattern.

**Step 5: Verify build**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds

**Step 6: Commit**

```
git add apps/web/src/pages/CodeTasksPage.tsx
git commit -m "feat: add responsive layout, loading, empty, and error states"
```

---

## Task 9: Delete Confirmation

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`

**Step 1: Port delete confirmation from existing CodeTaskCard**

The current implementation has inline delete confirmation inside each card. Port this pattern into `IssueGroupRow`:

- Add a delete icon button (Trash2) in the row, visible on hover
- On click: show inline confirmation panel with "Delete all N tasks for INT-XXX?" message
- Confirm deletes all tasks in the group sequentially: `for (const task of group.tasks) { await deleteTask(task.id); }`
- Cancel hides the confirmation

Use `stopPropagation` on the delete button and confirmation panel to prevent row navigation.

**Step 2: Verify build**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds

**Step 3: Commit**

```
git add apps/web/src/pages/CodeTasksPage.tsx
git commit -m "feat: add delete confirmation for issue groups"
```

---

## Task 10: Final Verification

**Files:** None (verification only)

**Step 1: Run all web tests**

Run: `cd apps/web && pnpm test`
Expected: All tests pass including the new issueGroups tests

**Step 2: Run full CI check**

Run: `pnpm run ci:tracked`
Expected: All checks pass

**Step 3: Verify type checking**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: No type errors

**Step 4: Manual smoke test checklist**

Start the dev server and verify against dev.intexuraos.cloud:
- [ ] Issues are grouped by Linear issue ID
- [ ] Pipeline shows correct step states for each issue
- [ ] "Implement" CTA appears for planned issues without execution
- [ ] PR links appear in Output column for completed issues
- [ ] Failed issues show red left border and "Retry" button
- [ ] Expanding a multi-task group shows timeline
- [ ] Clicking a row navigates to CodeTaskViewPage
- [ ] Status pipeline filter works and persists across refresh
- [ ] Counts in pipeline bar match visible groups
- [ ] Load More works and merges new tasks into existing groups
- [ ] Delete confirmation works
- [ ] Page refreshes on tab visibility change without flickering

**Step 5: Commit any remaining fixes and final commit**

```
git add -A
git commit -m "feat: complete code tasks list redesign with issue-centric grouped view"
```
