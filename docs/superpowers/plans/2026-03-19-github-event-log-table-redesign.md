# GitHub Event Log Table Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current card/expandable-row GitHub Event Log with a clean table showing only: time, event type, decision, user, and link to the corresponding entity.

**Architecture:** The page already exists at `/code-tasks/pr-events` (rendered by `PREventsPage`). We'll rewrite the page component and row component to use a grid-based table layout matching the CodeTasksPage pattern. The `useGitHubEventLog` hook, API calls, types, and Firestore live listener remain unchanged — only the presentation layer changes. The sidebar label changes from "PR Events" to "GitHub Event Log".

**Tech Stack:** React, TailwindCSS, lucide-react, existing `useGitHubEventLog` hook, existing `GitHubEventLogRow` types.

---

## File Structure

| File                                                 | Action     | Responsibility                                                           |
| ---------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| `apps/web/src/pages/GitHubEventLogPage.tsx`          | **Create** | New page component with table layout (replaces `PREventsPage`)           |
| `apps/web/src/components/GitHubEventLogTableRow.tsx` | **Create** | Single table row component (replaces `GitHubEventLogRow`)                |
| `apps/web/src/pages/PREventsPage.tsx`                | **Delete** | Replaced by `GitHubEventLogPage`                                         |
| `apps/web/src/components/GitHubEventLogRow.tsx`      | **Delete** | Replaced by `GitHubEventLogTableRow`                                     |
| `apps/web/src/components/PREventsGroup.tsx`          | **Keep**   | Still used by `CodeTaskViewPageV2.tsx` (PR timeline in task detail view) |
| `apps/web/src/hooks/useGitHubPREvents.ts`            | **Keep**   | Still used by `PREventsGroup`                                            |
| `apps/web/src/pages/index.ts`                        | **Modify** | Export `GitHubEventLogPage` instead of `PREventsPage`                    |
| `apps/web/src/components/index.ts`                   | **Modify** | Export `GitHubEventLogTableRow` instead of old components                |
| `apps/web/src/components/Sidebar.tsx:75`             | **Modify** | Rename sidebar label from "PR Events" to "GitHub Event Log", change icon |
| `apps/web/src/components/home/HeroShowcase.tsx:186`  | **Modify** | Rename decorative label from "PR Events" to "GitHub Event Log"           |
| `apps/web/src/App.tsx:280`                           | **Modify** | Change route element from `PREventsPage` to `GitHubEventLogPage`         |

## Table Columns

| Column     | Width   | Content                                      | Source field                                       |
| ---------- | ------- | -------------------------------------------- | -------------------------------------------------- |
| Time       | `100px` | `formatTimeOnly(row.authPassedAt)`           | `authPassedAt`                                     |
| Event Type | `1fr`   | `githubEventName.action` badge (color-coded) | `githubEventName`, `action`                        |
| Decision   | `160px` | Decision outcome badge (color-coded)         | `decisionOutcome`, `dispatchAction`, `reviewTypes` |
| User       | `120px` | `@senderLogin`                               | `senderLogin`                                      |
| Link       | `36px`  | External link icon to PR/issue/entity        | `repository`, `pullRequestNumber`                  |

## Design Rules (matching CodeTasksPage)

- **Desktop grid:** `hidden lg:grid grid-cols-[100px_1fr_160px_120px_36px]` with `ColumnHeader` above
- **Mobile:** Show a flex row with event badge, decision badge, and time only (hide user and link columns)
- **Row styling:** Same as code tasks — rounded-lg border, hover shadow, left accent border based on decision state
- **Memoization:** `memo()` with custom comparison on `row` reference + `isHydrating`
- **Loading/empty/error states:** Identical pattern to CodeTasksPage
- **No search, no filter pills** — just the table with header + refresh + live badge
- **Load more button** at bottom when `hasMore` is true

---

### Task 1: Create the table row component

**Files:**
- Create: `apps/web/src/components/GitHubEventLogTableRow.tsx`

- [ ] **Step 1: Create the row component**

```tsx
import { memo } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { GitHubEventLogListRow } from '@/hooks';
import { formatTimeOnly } from '@/utils/dateFormat';

export interface GitHubEventLogTableRowProps {
  row: GitHubEventLogListRow;
}

function formatEventLabel(row: GitHubEventLogListRow): string {
  const base = row.githubEventName;
  if (row.action === null || row.action === 'unknown') {
    return base;
  }
  return `${base}.${row.action}`;
}

function formatDecisionSummary(row: GitHubEventLogListRow): string {
  if (row.dispatchAction === 'create_review_task' && row.reviewTypes.length > 0) {
    return `requested_review(${row.reviewTypes.join(', ')})`;
  }
  if (row.dispatchAction !== null) {
    return row.dispatchAction;
  }
  if (row.decisionOutcome !== null) {
    return row.decisionOutcome;
  }
  return 'pending';
}

function decisionClasses(row: GitHubEventLogListRow): string {
  if (row.decisionState === 'pending') {
    return 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800';
  }
  if (row.decisionOutcome === 'request_review') {
    return 'bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:ring-sky-800';
  }
  if (row.decisionOutcome === 'dispatch') {
    return 'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:ring-emerald-800';
  }
  return 'bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600';
}

function eventClasses(row: GitHubEventLogListRow): string {
  const name = row.githubEventName;
  if (name === 'pull_request') {
    return 'bg-indigo-100 text-indigo-700 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:ring-indigo-800';
  }
  if (name === 'issue_comment' || name === 'pull_request_review_comment') {
    return 'bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:ring-orange-800';
  }
  if (name === 'pull_request_review') {
    return 'bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:ring-rose-800';
  }
  if (name === 'push') {
    return 'bg-teal-100 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:ring-teal-800';
  }
  if (name === 'check_run' || name === 'check_suite') {
    return 'bg-cyan-100 text-cyan-700 ring-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-400 dark:ring-cyan-800';
  }
  if (name === 'workflow_run' || name === 'workflow_job') {
    return 'bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:ring-violet-800';
  }
  if (name === 'create' || name === 'delete') {
    return 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800';
  }
  return 'bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600';
}

function getAccentShadow(row: GitHubEventLogListRow): string {
  if (row.decisionState === 'pending') return 'shadow-[inset_3px_0_0_theme(colors.amber.500)]';
  if (row.decisionOutcome === 'request_review') return 'shadow-[inset_3px_0_0_theme(colors.sky.500)]';
  if (row.decisionOutcome === 'dispatch') return 'shadow-[inset_3px_0_0_theme(colors.emerald.500)]';
  return '';
}

function buildEntityUrl(row: GitHubEventLogListRow): string | null {
  if (row.repository === null) {
    return null;
  }
  if (row.pullRequestNumber !== null) {
    return `https://github.com/${row.repository}/pull/${String(row.pullRequestNumber)}`;
  }
  return `https://github.com/${row.repository}`;
}

function GitHubEventLogTableRowComponent({ row }: GitHubEventLogTableRowProps): React.JSX.Element {
  const entityUrl = buildEntityUrl(row);

  return (
    <div
      className={`group overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${getAccentShadow(row)}`}
    >
      {/* Desktop: grid layout */}
      <div className="hidden items-center gap-2 px-3 py-1.5 lg:grid lg:grid-cols-[100px_1fr_160px_120px_36px]">
        {/* Time */}
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
          {formatTimeOnly(row.authPassedAt)}
        </span>

        {/* Event Type */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em] ring-1 ${eventClasses(row)}`}>
            {formatEventLabel(row)}
          </span>
          {row.isHydrating ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-500" />
          ) : null}
        </div>

        {/* Decision */}
        <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ring-1 ${decisionClasses(row)}`}>
          {formatDecisionSummary(row)}
        </span>

        {/* User */}
        <span className="truncate text-xs text-slate-600 dark:text-slate-400">
          @{row.senderLogin ?? 'system'}
        </span>

        {/* Link */}
        {entityUrl !== null ? (
          <a
            href={entityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center text-slate-400 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
            aria-label="Open on GitHub"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span />
        )}
      </div>

      {/* Mobile: compact flex row */}
      <div className="flex items-center gap-2 px-3 py-1.5 lg:hidden">
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
          {formatTimeOnly(row.authPassedAt)}
        </span>
        <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em] ring-1 ${eventClasses(row)}`}>
          {formatEventLabel(row)}
        </span>
        {row.isHydrating ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-500" />
        ) : null}
        <span className={`ml-auto inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ring-1 ${decisionClasses(row)}`}>
          {formatDecisionSummary(row)}
        </span>
      </div>
    </div>
  );
}

export const GitHubEventLogTableRow = memo(
  GitHubEventLogTableRowComponent,
  (prevProps, nextProps) =>
    prevProps.row === nextProps.row,
);
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/GitHubEventLogTableRow.tsx
git commit -m "feat(web): add GitHubEventLogTableRow grid component"
```

---

### Task 2: Create the new page component

**Files:**
- Create: `apps/web/src/pages/GitHubEventLogPage.tsx`

- [ ] **Step 1: Create the page component**

```tsx
import { RadioTower, RefreshCw, AlertCircle } from 'lucide-react';
import { Button, Layout } from '@/components';
import { GitHubEventLogTableRow } from '@/components/GitHubEventLogTableRow';
import { useGitHubEventLog } from '@/hooks';

// --- PageHeader ---

interface PageHeaderProps {
  totalCount: number;
  listenerHealthy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

function PageHeader({ totalCount, listenerHealthy, refreshing, onRefresh }: PageHeaderProps): React.JSX.Element {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            GitHub Event Log
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              listenerHealthy
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            }`}
          >
            <RadioTower className="h-3 w-3" />
            {listenerHealthy ? 'Live' : 'Polling'}
          </span>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {String(totalCount)} events
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        <span className="ml-2 hidden sm:inline">Refresh</span>
      </Button>
    </div>
  );
}

// --- ColumnHeader ---

function ColumnHeader(): React.JSX.Element {
  return (
    <div className="mb-1 hidden grid-cols-[100px_1fr_160px_120px_36px] gap-2 px-4 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500 lg:grid">
      <div>Time</div>
      <div>Event</div>
      <div>Decision</div>
      <div>User</div>
      <div />
    </div>
  );
}

// --- GitHubEventLogPage ---

export function GitHubEventLogPage(): React.JSX.Element {
  const {
    rows,
    loading,
    refreshing,
    loadingMore,
    error,
    listenerHealthy,
    hasMore,
    refresh,
    loadMore,
  } = useGitHubEventLog();

  if (loading && rows.length === 0) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageHeader
        totalCount={rows.length}
        listenerHealthy={listenerHealthy}
        refreshing={refreshing}
        onRefresh={(): void => { void refresh(); }}
      />

      {error !== null && error !== '' ? (
        <div className="mb-6 flex items-center gap-2 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {rows.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="py-12 text-center">
            <RadioTower className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="mb-2 text-slate-600 dark:text-slate-300">No events yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              GitHub webhook events will appear here as they arrive.
            </p>
          </div>
        </div>
      ) : (
        <div>
          <ColumnHeader />

          <div className="space-y-0.5">
            {rows.map((row) => (
              <GitHubEventLogTableRow key={row.id} row={row} />
            ))}
          </div>

          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={(): void => { void loadMore(); }}
                disabled={loadingMore}
                isLoading={loadingMore}
                loadingText="Loading..."
              >
                Load older events
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Layout>
  );
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/GitHubEventLogPage.tsx
git commit -m "feat(web): add GitHubEventLogPage with table layout"
```

---

### Task 3: Wire up exports, routing, and sidebar

**Files:**
- Modify: `apps/web/src/pages/index.ts`
- Modify: `apps/web/src/components/index.ts`
- Modify: `apps/web/src/App.tsx:280`
- Modify: `apps/web/src/components/Sidebar.tsx:75`

- [ ] **Step 1: Update page exports**

In `apps/web/src/pages/index.ts`:
- Remove `PREventsPage` export
- Add `GitHubEventLogPage` export

- [ ] **Step 2: Update component exports**

In `apps/web/src/components/index.ts`:
- Remove `GitHubEventLogRow` export (if present)
- Add `GitHubEventLogTableRow` export

- [ ] **Step 3: Update App.tsx routing**

In `apps/web/src/App.tsx`, change the route at line ~280:
- Replace `PREventsPage` import with `GitHubEventLogPage`
- Change `element={<PREventsPage />}` to `element={<GitHubEventLogPage />}`
- Keep the route path as `/code-tasks/pr-events` (URL stays the same for now)

- [ ] **Step 4: Update Sidebar label and icon**

In `apps/web/src/components/Sidebar.tsx`, line 75:
- Change `label: 'PR Events'` to `label: 'GitHub Event Log'`
- Change icon from `GitPullRequest` to `RadioTower` (import from lucide-react)
- The `to:` path stays `/code-tasks/pr-events`

- [ ] **Step 5: Update HeroShowcase decorative label**

In `apps/web/src/components/home/HeroShowcase.tsx`, line 186:
- Change `label="PR Events"` to `label="GitHub Event Log"`
- Change the icon from `GitPullRequest` to `RadioTower` (import from lucide-react)

- [ ] **Step 6: Verify everything compiles**

Run: `cd apps/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/index.ts apps/web/src/components/index.ts apps/web/src/App.tsx apps/web/src/components/Sidebar.tsx apps/web/src/components/home/HeroShowcase.tsx
git commit -m "feat(web): wire GitHubEventLogPage into routing and sidebar"
```

---

### Task 4: Delete old page and row components

**Files:**
- Delete: `apps/web/src/pages/PREventsPage.tsx`
- Delete: `apps/web/src/components/GitHubEventLogRow.tsx`
- Keep: `apps/web/src/components/PREventsGroup.tsx` (still used by `CodeTaskViewPageV2.tsx` for PR timeline in task detail view)
- Keep: `apps/web/src/hooks/useGitHubPREvents.ts` (still used by `PREventsGroup`)

- [ ] **Step 1: Check for remaining imports of files being deleted**

Run: `rg "PREventsPage|GitHubEventLogRow[^T]" apps/web/src/ -l` (exclude `GitHubEventLogTableRow` matches)

Expected: Only the files being deleted, their test files, and barrel exports. Fix any remaining references first.

- [ ] **Step 2: Delete old files**

```bash
rm apps/web/src/pages/PREventsPage.tsx
rm apps/web/src/components/GitHubEventLogRow.tsx
```

- [ ] **Step 3: Remove old exports from barrel files**

In `apps/web/src/components/index.ts`, remove the `GitHubEventLogRow` re-export (if present).
In `apps/web/src/pages/index.ts`, ensure `PREventsPage` export was already removed in Task 3.

- [ ] **Step 4: Remove any unused imports in Sidebar.tsx**

If `GitPullRequest` is no longer used anywhere in `Sidebar.tsx` after the icon change, remove it from the lucide-react import.

- [ ] **Step 5: Verify compilation**

Run: `cd apps/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "refactor(web): remove old PREventsPage and GitHubEventLogRow components"
```

---

### Task 5: Delete old test files and verify full CI

**Files:**
- Check/Delete: Any test files for deleted components

- [ ] **Step 1: Find test files for deleted components**

```bash
rg "PREventsPage|GitHubEventLogRow[^T]" apps/web/src/__tests__/ apps/web/src/components/__tests__/ -l 2>/dev/null
```

Delete any test files that only tested `PREventsPage` or `GitHubEventLogRow` (not `GitHubEventLogTableRow`).

- [ ] **Step 2: Check for stale references to deleted files**

```bash
rg "PREventsPage|GitHubEventLogRow[^T]" apps/web/src/ -l
```

Expected: Zero results. (`PREventsGroup` and `useGitHubPREvents` are still in use and should NOT appear in this search.)

- [ ] **Step 3: Run full verification**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: All checks pass.

- [ ] **Step 4: Final commit**

```bash
git add -u
git commit -m "chore(web): clean up tests for removed PR event components"
```

---

### Task 6: Audit homepage references

**Files:**
- Check: `apps/web/src/pages/HomePage.tsx`

Note: `HeroShowcase.tsx` is already handled in Task 3 Step 5.

- [ ] **Step 1: Read HomePage and check for PR Events references**

Look for any references to `PREventsGroup`, `PREventsPage`, `useGitHubPREvents`, or the old component names in `HomePage.tsx`.

- [ ] **Step 2: Update any references found**

If the homepage uses old component names or "PR Events" labels:
- Update labels to "GitHub Event Log"
- Update icon references to `RadioTower`

- [ ] **Step 3: Verify and commit**

Run: `pnpm run verify:workspace:tracked -- web`

```bash
git add -u
git commit -m "fix(web): update homepage references to GitHub Event Log"
```

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** `GET /code/github-event-log`, `POST /code/github-event-log/rows` (hydration), `GET /code/github-pr-events` (deleted from frontend usage only — backend route remains)
