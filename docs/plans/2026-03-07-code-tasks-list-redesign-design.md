# Code Tasks List Redesign — Issue-Centric Grouped View

**Date:** 2026-03-07
**Scope:** `apps/web` only — CodeTasksPage list view. Detail page (CodeTaskViewPage) is a separate future effort.
**Backend changes:** None. All grouping is client-side.

## Problem

The current code tasks list renders each task as an independent card. A single Linear issue (e.g. INT-735) can spawn 2-5 code tasks: planning, execution, failed retries, PR comment follow-ups. Users must mentally reconstruct which tasks belong together. Additional issues: badge overload (7-10 per card), duplicated Linear ID, no status counts, buried "Ready to implement" CTA, no duration display.

## Solution

Group tasks by `linearIssueId`. Each row = one Linear issue with a visual pipeline (Planning -> Execution -> PR). Expand to see full task timeline. Filter by group status, not individual task status.

## Data Layer

### New types (in `CodeTasksPage.tsx` or a new `utils/issueGroups.ts`)

```typescript
interface IssueGroup {
  linearIssueId: string | null;        // null = no-Linear tasks (keyed by task ID)
  linearIssue: CodeTask['linearIssue'] | undefined;
  tasks: CodeTask[];                    // all tasks for this issue, newest first
  pipeline: PipelineState;
  latestTask: CodeTask;
  aggregateStatus: GroupStatus;
}

type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed';

interface PipelineState {
  planning: StepState | null;
  execution: StepState | null;
  pr: { url: string; number: string } | null;
  failedAttempts: number;
  archivedCount: number;
}

type StepState = 'completed' | 'running' | 'failed' | 'waiting' | 'actionable';
```

### Grouping function (`groupByLinearIssue`)

Pure function, unit-testable.

1. Collect tasks into `Map<string, CodeTask[]>` keyed by `linearIssueId`. Tasks without `linearIssueId` get individual groups keyed by task `id`.
2. For each group, derive `PipelineState`:
   - Latest planning task: `agentType === 'planning'`, highest `updatedAt`, excluding `archived`
   - Latest execution task: `agentType === 'execution'`, same rules
   - Planning step: `'completed'` if `planned`/`implemented`, `'running'` if active, `'failed'` if failed
   - Execution step: `'completed'` if `implemented`, `'actionable'` if planning done but no `implementationTaskId`, `'failed'` if failed, `'running'` if active
   - PR step: present if any task has `result?.prUrl`
   - `failedAttempts`: count non-archived `failed` tasks
   - `archivedCount`: count `archived` tasks
3. Derive `aggregateStatus`:
   - `'active'`: any task is `running | dispatched | queued`
   - `'needs-action'`: has planned task without `implementationTaskId`
   - `'failed'`: latest non-archived task is `failed | interrupted`
   - `'done'`: otherwise
4. Sort: `active` first, then `needs-action`, then `failed`, then `done`. Within same status, by `latestTask.updatedAt` desc.

### Page size

Pass `limit: 50` from `useCodeTasks` hook. API already accepts `maximum: 100` (line 1486, `codeRoutes.ts`). Server default is 20 (line 1487). No backend change.

## Component Architecture

```
CodeTasksPage
  PageHeader              (title, subtitle with counts, New Task button)
  StatusPipeline          (filter bar with group counts)
  ColumnHeader            (Issue | Pipeline | Worker | Time | Output)
  IssueGroupList
    IssueGroupRow[key]    (React.memo'd)
      IssueRowCollapsed   (always visible — grid row)
      IssueTimeline       (conditional — expanded view)
```

### IssueGroupRow (collapsed) — grid layout

```
grid-template-columns: 200px 1fr 200px 140px 120px
```

| Column   | Content                                               | Source                                                       |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| Issue    | `linearIssueId` clickable link + title (1-line clamp) | `linearIssue.url`, `linearIssue.title`                       |
| Pipeline | Visual step chain with state icons                    | `PipelineState`                                              |
| Worker   | Model tag + location + health dot                     | `latestTask.workerType`, `workerLocation`, `workerHealthMap` |
| Time     | Relative ("5 min ago") + duration ("took 5m 12s")     | `latestTask.updatedAt`, `updatedAt - createdAt`              |
| Output   | Implement CTA / PR link / Retry / spinner             | `PipelineState` + `result?.prUrl`                            |

Left border accent: green = needs-action, red = failed, blue = active, none = done.

Expand chevron visible when group has 2+ tasks.

### IssueTimeline (expanded)

Vertical timeline, newest first. Each item:
- Colored dot (green/red/blue/violet/slate)
- Action label ("Execution completed", "Planning completed", etc.)
- Two chips max: model + worker location (if different from row)
- Detail line: PR link, prompt snippet, or error message
- `followUpReason` chip when relevant (retry = amber, PR comment = blue)

Footer: "2 tasks · 1 archived · click to collapse"

### Pipeline rendering rules

| Planning state | Execution state                        | Render                                   |
| -------------- | -------------------------------------- | ---------------------------------------- |
| completed      | not started, no `implementationTaskId` | ✓ Planning → **▶ Implement** (green CTA) |
| completed      | running                                | ✓ Planning → ◌ Running (blue)            |
| completed      | completed + PR                         | ✓ Planning → ✓ Execution → ✓ PR          |
| completed      | failed                                 | ✓ Planning → ✗ Failed + attempt count    |
| none           | completed + PR                         | ✓ Execution → ✓ PR                       |
| none           | failed                                 | ✗ Failed + attempt count                 |

### Tasks without linearIssueId

Issue column shows first 40 chars of `sanitizedPrompt`. No ID link. Single-task group.

## StatusPipeline Filter

Filter by `GroupStatus`, not individual task status.

| Segment      | Matches                                     | Color                    |
| ------------ | ------------------------------------------- | ------------------------ |
| Active       | any task `running \                         | dispatched \             | queued` | blue (pulsing) |
| Needs Action | planned task without `implementationTaskId` | green                    |
| Done         | has PR or all terminal, none failed         | green (static)           |
| Failed       | latest non-archived is `failed \            | interrupted`             | red |
| Archived     | ALL tasks are `archived`                    | slate, hidden by default |

Counts from `useMemo` over `issueGroups`. Subtitle: "5 issues · 1 needs attention · 1 failed".

Filter persistence: `localStorage` key `code-tasks-group-filter`. Migration: if old key exists and new doesn't, default to all non-archived.

## Rendering Performance

### Memoization

- `IssueGroupRow`: `React.memo` with custom comparator checking `group` reference + `workerHealthMap` reference
- `groupByLinearIssue`: called inside `useMemo(() => ..., [tasks])`
- Worker health: `useMemo(() => new Map(workers.map(w => [w.name, w.status])), [workersStatus])`
- Action handler: single `useCallback` taking `(taskId, action)` tuple

### Merge-based refresh (stable references)

Replace `setTasks(data.tasks)` with merge:
- Build `Map<id, task>` of incoming
- For each incoming, compare `id + status + updatedAt` against existing
- Keep old reference if identical (downstream memo skips)
- Only create new array if at least one task changed

### Navigation

- Click collapsed row → navigate to `CodeTaskViewPage` for `group.latestTask.id`
- Click expand chevron → toggle timeline (stopPropagation)
- Click Linear ID / PR link → open in new tab (stopPropagation)

## Duration Calculation

Reuse `formatElapsedTime` from `utils/dateFormat.ts` (line 172, already exported).
- Terminal tasks: `(new Date(updatedAt) - new Date(createdAt)) / 1000`
- Active tasks: `(Date.now() - new Date(createdAt)) / 1000`

## Files Changed

| File                                               | Change                                |
| -------------------------------------------------- | ------------------------------------- |
| `apps/web/src/pages/CodeTasksPage.tsx`             | Complete rewrite — new components     |
| `apps/web/src/hooks/useCodeTasks.ts`               | Add `limit: 50`, merge-based refresh  |
| `apps/web/src/utils/issueGroups.ts`                | **NEW** — `groupByLinearIssue`, types |
| `apps/web/src/utils/__tests__/issueGroups.test.ts` | **NEW** — unit tests for grouping     |

## Out of Scope

- CodeTaskViewPage redesign (separate future effort)
- Backend API changes
- `completedAt` / `retriedFrom` field exposure (nice-to-have, not needed)
- Real-time Firestore listeners for the list (current HTTP refresh is sufficient)
