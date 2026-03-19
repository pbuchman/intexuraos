# Merge Queue Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Merge Queue page to the web app that displays open PRs for a base branch, lets the user toggle auto-merging via a watch, and shows merge history.

**Architecture:** New page at `/#/merge-queue` in the web app. Uses existing `apiRequest` client to call code-agent endpoints. Components follow existing Code Tasks patterns (StatusPipeline, IssueGroupRow card rows, IssueTimeline).

**Tech Stack:** React 18, TailwindCSS, React Router (hash), lucide-react icons, `@auth0/auth0-react`.

**Spec:** `docs/superpowers/specs/2026-03-19-merge-queue-design.md`
**Mockup:** https://intexuraos.cloud/share/claude/merge-queue-mockup-v2.html
**Depends on:** `docs/superpowers/plans/2026-03-19-merge-queue-backend.md` (backend must be deployed first)

---

## File Structure

### New files (web app)

| File                                                  | Responsibility                                            |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `src/services/mergeQueueApi.ts`                       | API client functions for merge queue endpoints            |
| `src/pages/MergeQueuePage.tsx`                        | Top-level page component                                  |
| `src/components/merge-queue/BranchSelector.tsx`       | Branch pills (radio select)                               |
| `src/components/merge-queue/WatchStatusCard.tsx`      | Toggle + watch state card (active/drained/error/inactive) |
| `src/components/merge-queue/PrStatusPipeline.tsx`     | Filter pills: Mergeable / Pending / Blocked               |
| `src/components/merge-queue/PrRow.tsx`                | Single PR card row with accent shadow                     |
| `src/components/merge-queue/PrList.tsx`               | Column header + list of PrRow                             |
| `src/components/merge-queue/MergeHistoryTimeline.tsx` | Collapsible timeline of merged PRs                        |
| `src/types/mergeQueue.ts`                             | TypeScript types for API responses                        |

### Modified files (web app)

| File                         | Change                                       |
| ---------------------------- | -------------------------------------------- |
| `src/components/Sidebar.tsx` | Add Merge Queue nav item to `codeTasksItems` |
| `src/App.tsx`                | Add `/#/merge-queue` route                   |

---

## Task 1: Types

**Files:**
- Create: `apps/web/src/types/mergeQueue.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// apps/web/src/types/mergeQueue.ts

export interface MergeQueueBranch {
  name: string;
  openPrCount: number;
}

export interface MergeQueuePr {
  number: number;
  title: string;
  author: string;
  authorIsEligible: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  checksStatus: 'success' | 'failure' | 'pending';
  createdAt: string;
  htmlUrl: string;
}

export type PrFilterStatus = 'mergeable' | 'pending' | 'blocked';

export interface MergedPrEntry {
  prNumber: number;
  title: string;
  author: string;
  mergedAt: string;
}

export interface SkippedPrEntry {
  prNumber: number;
  reason: string;
}

export type WatchStatus = 'active' | 'drained' | 'cancelled';

export interface MergeQueueWatch {
  watchId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  status: WatchStatus;
  mergedPrs: MergedPrEntry[];
  skippedPrs: SkippedPrEntry[];
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  lastTickAt: string | null;
  drainedAt: string | null;
}
```

- [ ] **Step 2: Export from types index**

Add to `apps/web/src/types/index.ts`:

```typescript
export type {
  MergeQueueBranch,
  MergeQueuePr,
  PrFilterStatus,
  MergedPrEntry,
  SkippedPrEntry,
  WatchStatus,
  MergeQueueWatch,
} from './mergeQueue.js';
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types/mergeQueue.ts apps/web/src/types/index.ts
git commit -m "feat(web): add merge queue type definitions"
```

---

## Task 2: API Client

**Files:**
- Create: `apps/web/src/services/mergeQueueApi.ts`

- [ ] **Step 1: Create API functions**

Follow the `codeAgentApi.ts` pattern — each function calls `apiRequest<T>()`:

```typescript
// apps/web/src/services/mergeQueueApi.ts
import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { MergeQueueBranch, MergeQueuePr, MergeQueueWatch } from '@/types';

export async function listBranches(
  accessToken: string,
  owner: string,
  repo: string
): Promise<{ branches: MergeQueueBranch[] }> {
  const params = new URLSearchParams({ owner, repo });
  return apiRequest(config.codeAgentUrl, `/code/merge-queue/branches?${params.toString()}`, accessToken);
}

export async function listPrs(
  accessToken: string,
  owner: string,
  repo: string,
  baseBranch: string
): Promise<{ pullRequests: MergeQueuePr[] }> {
  const params = new URLSearchParams({ owner, repo, baseBranch });
  return apiRequest(config.codeAgentUrl, `/code/merge-queue/prs?${params.toString()}`, accessToken);
}

export async function listWatches(
  accessToken: string,
  owner: string,
  repo: string
): Promise<{ watches: MergeQueueWatch[] }> {
  const params = new URLSearchParams({ owner, repo });
  return apiRequest(config.codeAgentUrl, `/code/merge-queue/watches?${params.toString()}`, accessToken);
}

export async function createWatch(
  accessToken: string,
  owner: string,
  repo: string,
  baseBranch: string
): Promise<MergeQueueWatch> {
  return apiRequest(config.codeAgentUrl, '/code/merge-queue/watch', accessToken, {
    method: 'POST',
    body: { owner, repo, baseBranch },
  });
}

export async function cancelWatch(
  accessToken: string,
  watchId: string
): Promise<{ success: boolean }> {
  return apiRequest(config.codeAgentUrl, `/code/merge-queue/watch/${watchId}`, accessToken, {
    method: 'DELETE',
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/services/mergeQueueApi.ts
git commit -m "feat(web): add merge queue API client"
```

---

## Task 3: Navigation + Route

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add nav item to Sidebar**

In `Sidebar.tsx`, add `GitMerge` to the lucide-react imports. Add to `codeTasksItems`:

```typescript
{ to: '/merge-queue', label: 'Merge Queue', icon: GitMerge },
```

- [ ] **Step 2: Add route to App.tsx**

Import `MergeQueuePage` (lazy import or direct). Add route:

```typescript
<Route
  path="/merge-queue"
  element={
    <ProtectedRoute>
      <Layout>
        <MergeQueuePage />
      </Layout>
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Create placeholder page**

Create `apps/web/src/pages/MergeQueuePage.tsx` with a minimal placeholder:

```typescript
export function MergeQueuePage(): React.JSX.Element {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Merge Queue</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">Coming soon</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify navigation works**

Run: `pnpm --filter web dev`

Navigate to `/#/merge-queue`. Should see the placeholder. Sidebar item should be highlighted.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx apps/web/src/App.tsx apps/web/src/pages/MergeQueuePage.tsx
git commit -m "feat(web): add merge queue route and nav item"
```

---

## Task 4: BranchSelector Component

**Files:**
- Create: `apps/web/src/components/merge-queue/BranchSelector.tsx`

- [ ] **Step 1: Implement component**

Props: `branches: MergeQueueBranch[]`, `selected: string | null`, `onSelect: (branch: string) => void`

Use the StatusPipeline pattern from `CodeTasksPage.tsx`:
- `rounded-full border px-3 py-1.5 text-sm`
- Blue dot (`bg-blue-500`) for all branches
- Active: `border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400`
- Inactive: `border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400`
- Radio behavior (one active at a time)
- Show PR count as `<span className="font-medium">{count}</span>`

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/merge-queue/BranchSelector.tsx
git commit -m "feat(web): add BranchSelector component"
```

---

## Task 5: WatchStatusCard Component

**Files:**
- Create: `apps/web/src/components/merge-queue/WatchStatusCard.tsx`

- [ ] **Step 1: Implement component**

Props: `watch: MergeQueueWatch | null`, `onToggle: () => void`, `isToggling: boolean`

Five states:

1. **No watch (`null`)**: Show toggle switch in off position with label "Auto-merge". No card background — just the toggle + label inline.
2. **Active (no error)**: Blue card (`border-blue-200 bg-blue-50`), Loader2 animate-spin, stats line: `"Merged: {mergedPrs.length} · Skipped: {skippedPrs.length} · Last tick: {formatRelative(lastTickAt)}"`, toggle ON
3. **Active with error** (`lastError` non-null): Red card (`border-red-200 bg-red-50`), AlertCircle, error message + `formatRelative(lastErrorAt)`, stats line below, toggle ON
4. **Drained**: Emerald card (`border-emerald-200 bg-emerald-50`), CheckCircle2, `"Merged: {mergedPrs.length} · Completed {formatRelative(drainedAt)}"`, toggle OFF
5. **Cancelled**: No card — same as "no watch" state (toggle OFF). Cancelled watches are past state; the UI treats them as inactive.

Toggle switch: CSS-only implementation matching the mockup v2. When `isToggling` is true, disable the toggle and show a small spinner.

Import `formatRelative` from `@/utils/dateFormat` for timestamps.

Toggling ON → calls `createWatch`. Toggling OFF → calls `cancelWatch`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/merge-queue/WatchStatusCard.tsx
git commit -m "feat(web): add WatchStatusCard component with toggle"
```

---

## Task 6: PrStatusPipeline + PrRow + PrList

**Files:**
- Create: `apps/web/src/components/merge-queue/PrStatusPipeline.tsx`
- Create: `apps/web/src/components/merge-queue/PrRow.tsx`
- Create: `apps/web/src/components/merge-queue/PrList.tsx`

- [ ] **Step 1: Implement PrStatusPipeline**

Props: `counts: Record<PrFilterStatus, number>`, `activeFilters: Set<PrFilterStatus>`, `onToggle: (status: PrFilterStatus) => void`

Same pattern as `StatusPipeline` in `CodeTasksPage.tsx`. Three statuses: Mergeable (green), Pending (amber), Blocked (red).

- [ ] **Step 2: Implement PrRow**

Props: `pr: MergeQueuePr`, `isNextToMerge: boolean`

Card row matching `IssueGroupRow` pattern:
- `rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm hover:shadow-md dark:border-slate-700 dark:bg-slate-800`
- Accent shadow based on status: green (mergeable), amber (pending), red (blocked)
- Desktop grid: `grid-cols-[60px_1fr_120px_100px_100px]`
- Mobile: flex column fallback
- `isNextToMerge`: show blue indicator dot
- Non-eligible: `opacity-50` + title tooltip
- PR number as blue monospace link to `htmlUrl`
- Show "Created {date}" in subtitle
- Status + Checks as rounded-full badges

Derive PR status:
```typescript
function getPrStatus(pr: MergeQueuePr): PrFilterStatus {
  if (pr.mergeable === true && pr.checksStatus === 'success') return 'mergeable';
  if (pr.checksStatus === 'pending' || pr.mergeable === null) return 'pending';
  return 'blocked';
}
```

- [ ] **Step 3: Implement PrList**

Props: `prs: MergeQueuePr[]`, `activeFilters: Set<PrFilterStatus>`

Column header (same pattern as `CodeTasksPage` `ColumnHeader`):
- `hidden lg:grid grid-cols-[60px_1fr_120px_100px_100px] px-4 text-xs font-medium uppercase tracking-wider text-slate-500`

"Merge order: oldest first" indicator with down arrow icon.

Filter PRs by `activeFilters`. PRs are pre-sorted by API (oldest first). First mergeable + eligible PR gets `isNextToMerge={true}`.

Container: `<div className="space-y-1">{rows}</div>`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/merge-queue/PrStatusPipeline.tsx
git add apps/web/src/components/merge-queue/PrRow.tsx
git add apps/web/src/components/merge-queue/PrList.tsx
git commit -m "feat(web): add PR list components for merge queue"
```

---

## Task 7: MergeHistoryTimeline

**Files:**
- Create: `apps/web/src/components/merge-queue/MergeHistoryTimeline.tsx`

- [ ] **Step 1: Implement component**

Props: `mergedPrs: MergedPrEntry[]`

Follow the `IssueTimeline` pattern from `apps/web/src/components/code-tasks/IssueTimeline.tsx`:
- Outer: `border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/50`
- "Merge History" section header
- Timeline: `border-l-2 border-slate-300 pl-2 dark:border-zinc-700`
- Each item: relative positioned dot (`bg-emerald-500 h-2.5 w-2.5 rounded-full`), PR number (blue mono link), title, `"Merged {formatRelative(mergedAt)} · {author}"`
- Collapsible: show/hide with state. Footer button: "{count} merged · click to collapse"
- If `mergedPrs` is empty, don't render at all

Use `formatRelative` from `@/utils/dateFormat` for timestamps.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/merge-queue/MergeHistoryTimeline.tsx
git commit -m "feat(web): add MergeHistoryTimeline component"
```

---

## Task 8: MergeQueuePage (Full Assembly)

**Files:**
- Modify: `apps/web/src/pages/MergeQueuePage.tsx`

- [ ] **Step 1: Implement the full page**

Replace the placeholder with the full implementation. The page manages:

**Constants:**

```typescript
const DEFAULT_OWNER = 'pbuchman';
const DEFAULT_REPO = 'intexuraos';
```

**State:**
- `branches: MergeQueueBranch[]` — from `listBranches` API
- `selectedBranch: string | null` — currently selected branch
- `prs: MergeQueuePr[]` — from `listPrs` API (for selected branch)
- `watches: MergeQueueWatch[]` — from `listWatches` API
- `activeFilters: Set<PrFilterStatus>` — default: all three enabled
- `isToggling: boolean` — loading state for watch create/cancel
- `loading: boolean` — initial page load
- `error: string | null` — API error message for initial load failure
- `prsLoading: boolean` — loading state when switching branches or refreshing PR list

**Data flow:**
1. On mount: fetch `listBranches` + `listWatches` in parallel. If either fails, set `error`.
2. Auto-select first branch (most PRs)
3. On branch select: set `prsLoading = true`, fetch `listPrs` for that branch, clear on completion
4. Poll `listWatches` every 30s to update watch state (merged count, skipped, last tick). Use `document.visibilityState` — pause polling when tab is hidden.
5. Poll `listPrs` every 60s to update mergeability. Same visibility check.

**Toggle handler:**
- If no active watch for selected branch → call `createWatch`
- If active watch exists → call `cancelWatch`
- Set `isToggling` during the API call
- On success, refetch watches immediately

**Error/empty states:**
- **API error on initial load**: Show error banner (red card with retry button), no other components
- **Empty branches** (no open PRs in repo): Show empty state: "No open pull requests found in {owner}/{repo}"
- **Empty PRs for branch**: Show empty state: "No open PRs targeting {branch}"
- **PR list loading**: Show skeleton/spinner in the PR list area while `prsLoading` is true

**PageHeader subtitle:**

Compute from `prs` array:
```typescript
const open = prs.length;
const mergeable = prs.filter(p => p.mergeable === true && p.checksStatus === 'success').length;
const blocked = prs.filter(p => p.mergeable === false || p.checksStatus === 'failure').length;
const pending = open - mergeable - blocked;
// → "8 open · 4 mergeable · 2 blocked · 2 pending"
```

**Layout (matching mockup v2):**
```
PageHeader (title + subtitle + repo selector)
BranchSelector
WatchStatusCard (with toggle)
PrStatusPipeline
PrList (fixed oldest-first order, no SortSelector — descoped per mockup v2)
MergeHistoryTimeline
```

**Hardcoded repo for now**: Extracted to `DEFAULT_OWNER` / `DEFAULT_REPO` constants. The repo selector is a secondary concern — start with constants, can add a dropdown later.

- [ ] **Step 2: Verify visually**

Run: `pnpm --filter web dev`

Navigate to `/#/merge-queue`. Verify:
- Branch pills load
- PRs load when branch is selected
- Toggle creates/cancels watch
- Watch card updates
- Timeline shows merge history
- Filter pills work

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/MergeQueuePage.tsx
git commit -m "feat(web): implement MergeQueuePage with full data flow"
```

---

## Task 9: Full CI Verification

- [ ] **Step 1: Build**

Run: `pnpm build`

- [ ] **Step 2: Run CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-merge-queue-fe.txt`

Expected: All workspaces pass. Web app has no coverage enforcement (per CLAUDE.md), but ensure no build errors.

- [ ] **Step 3: If failures, fix and re-run**

- [ ] **Step 4: Commit any fixes**

```bash
git commit -m "fix(web): fix CI issues from merge queue frontend"
```
