# Merge Queue — Design Spec

**Date:** 2026-03-19
**Service:** code-agent + web

## Overview

Automated PR merge queue. User selects a base branch, starts watching it. A cron (every 1 minute) iterates open PRs oldest-first, merges the first one that is mergeable (no conflicts + all status checks passing), skips the rest. Continues until no open PRs remain with any skipped PRs still present (watches for them to become mergeable after conflict resolution). Records skip reasons for visibility.

Only PRs authored by the authenticated user or the IntexuraOS bot are eligible.

Merge strategy: merge commit.

## Endpoint Changes

### Created

#### `POST /internal/merge-queue/tick`

Cron endpoint. Processes one merge cycle for all active watches.

No request body.

**Response:**

```json
{
  "results": [
    {
      "watchId": "watch_abc123",
      "owner": "pbuchman",
      "repo": "intexuraos",
      "baseBranch": "development",
      "action": "merged",
      "mergedPrNumber": 1342,
      "remainingPrs": 4,
      "skipped": [
        { "prNumber": 1340, "reason": "checks_failing" },
        { "prNumber": 1341, "reason": "merge_conflict" }
      ]
    },
    {
      "watchId": "watch_def456",
      "action": "drained",
      "remainingPrs": 0,
      "skipped": []
    }
  ]
}
```

Actions: `merged` | `skipped_all` | `drained` | `error`

- `merged` — one PR was merged, others may have been skipped
- `skipped_all` — no PR was mergeable this tick, but open PRs remain
- `drained` — zero open PRs remain with zero skipped; watch transitions to `drained`
- `error` — GitHub API error (token expired, rate limit, etc.)

#### `POST /code/merge-queue/watch`

JWT-authenticated. Creates a watch on a base branch.

**Request:**

```json
{
  "owner": "pbuchman",
  "repo": "intexuraos",
  "baseBranch": "development"
}
```

**Response:**

```json
{
  "watchId": "watch_abc123",
  "status": "active",
  "baseBranch": "development",
  "owner": "pbuchman",
  "repo": "intexuraos",
  "createdAt": "2026-03-19T12:00:00Z"
}
```

**Validation:**

- One active watch per (userId, owner, repo, baseBranch) — reject duplicate with 409.
- Verify user has push access to the repo via GitHub API before creating.

#### `DELETE /code/merge-queue/watch/:watchId`

JWT-authenticated. Cancels an active watch. Sets status to `cancelled`.

**Response:** `{ "success": true }`

#### `GET /code/merge-queue/watches`

JWT-authenticated. Lists watches for the authenticated user.

**Query params:** `owner`, `repo` (required)

**Response:**

```json
{
  "watches": [
    {
      "watchId": "watch_abc123",
      "owner": "pbuchman",
      "repo": "intexuraos",
      "baseBranch": "development",
      "status": "active",
      "mergedPrs": [1335, 1336, 1337],
      "mergedCount": 3,
      "skippedPrs": [
        { "prNumber": 1340, "reason": "merge_conflict" },
        { "prNumber": 1341, "reason": "checks_failing" }
      ],
      "createdAt": "2026-03-19T12:00:00Z",
      "lastTickAt": "2026-03-19T12:05:00Z",
      "drainedAt": null
    }
  ]
}
```

#### `GET /code/merge-queue/branches`

JWT-authenticated. Returns base branches that have at least one open PR.

**Query params:** `owner`, `repo` (required)

**Response:**

```json
{
  "branches": [
    { "name": "development", "openPrCount": 5 },
    { "name": "main", "openPrCount": 2 },
    { "name": "release/v2.1", "openPrCount": 1 }
  ]
}
```

#### `GET /code/merge-queue/prs`

JWT-authenticated. Returns open PRs for a base branch with mergeability info.

**Query params:** `owner`, `repo`, `baseBranch` (all required)

**Response:**

```json
{
  "pullRequests": [
    {
      "number": 1338,
      "title": "feat: add OpenRouter support",
      "author": "pbuchman",
      "authorIsEligible": true,
      "mergeable": true,
      "mergeableState": "clean",
      "checksStatus": "success",
      "createdAt": "2026-03-18T10:00:00Z",
      "htmlUrl": "https://github.com/pbuchman/intexuraos/pull/1338"
    },
    {
      "number": 1340,
      "title": "fix: retry logic",
      "author": "intexuraos-bot[bot]",
      "authorIsEligible": true,
      "mergeable": false,
      "mergeableState": "conflicting",
      "checksStatus": "failure",
      "createdAt": "2026-03-18T14:00:00Z",
      "htmlUrl": "https://github.com/pbuchman/intexuraos/pull/1340"
    }
  ]
}
```

`authorIsEligible` — true if the author is the watch creator or the IntexuraOS bot. The UI uses this to visually indicate which PRs would be picked up by the watch.

### Modified

None.

### Removed

None.

### Unchanged

All existing `/internal/` and `/code/` endpoints remain unchanged.

## GitHubPRClient Port Changes

New method on the `GitHubPRClient` port:

```typescript
mergePullRequest(params: {
  owner: string;
  repo: string;
  pullNumber: number;
  mergeMethod: 'merge';
  commitTitle?: string;
}): Promise<Result<{ sha: string; merged: boolean }, GitHubApiError>>;
```

Implementation: `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` via GitHub REST API.

## Firestore

### New collection: `merge_queue_watches`

Owner: code-agent (register in `firestore-collections.json`).

```typescript
interface MergeQueueWatch {
  id: string;
  userId: string;             // Auth0 user ID — resolves GitHub token at merge time
  owner: string;
  repo: string;
  baseBranch: string;
  status: 'active' | 'drained' | 'cancelled';
  mergedPrs: number[];        // PR numbers merged by this watch
  skippedPrs: SkippedPr[];    // Current tick's skip reasons
  createdAt: Timestamp;
  lastTickAt: Timestamp | null;
  drainedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
}

interface SkippedPr {
  prNumber: number;
  reason: 'merge_conflict' | 'checks_failing' | 'checks_pending' | 'not_eligible_author';
}
```

## Tick Logic (use case)

```
MergeQueueTickUseCase:
  1. Query all watches where status === 'active'
  2. For each watch:
     a. Resolve GitHub token via userServiceClient (userId → token)
     b. List open PRs for (owner, repo, baseBranch) ordered by createdAt ASC
     c. Filter to eligible authors (watch creator's GitHub username + intexuraos bot)
     d. For each PR (oldest first):
        - Get PR details (mergeable, mergeableState, checks)
        - If mergeable === true AND checksStatus === 'success':
          → Call mergePullRequest()
          → Append PR number to watch.mergedPrs
          → Record skipped PRs from earlier in the iteration
          → Return action: 'merged'
          → STOP (one merge per tick per watch)
        - Else: add to skipped list with reason
     e. If no PR was merged:
        - If open eligible PRs exist → action: 'skipped_all'
        - If zero open PRs remain → set status: 'drained', action: 'drained'
     f. Update watch document (lastTickAt, skippedPrs, etc.)
  3. Return results array
```

## Auto-Termination

Watch transitions to `drained` when:
- Zero open PRs remain targeting the base branch from eligible authors, AND
- Zero PRs were skipped in this tick

This means: if 3 PRs are stuck with conflicts, the watch stays `active` — they might become mergeable after someone pushes a fix. Only when the branch is truly empty does it stop.

## Cron Setup

Cloud Scheduler job: `merge-queue-tick`
- Schedule: `* * * * *` (every 1 minute)
- Target: `POST /internal/merge-queue/tick`
- Auth: HMAC-SHA256 internal auth header

The tick endpoint is idempotent — if no active watches exist, it returns an empty results array.

## Web UI

### Navigation

New entry in `codeTasksItems` array in `Sidebar.tsx`:

```typescript
{ to: '/merge-queue', label: 'Merge Queue', icon: GitMerge }
```

### Route

`/#/merge-queue` — single page, approach A (no detail view needed).

### Page Structure

Uses the same component patterns as `CodeTasksPage`.

#### PageHeader

- Left: `"Merge Queue"` (text-2xl font-bold) + summary subtitle: `"5 open · 2 mergeable · 1 blocked"`
- Right: repo selector (small secondary button/dropdown for owner/repo)

#### BranchSelector (StatusPipeline pattern)

Branch pills using the exact `StatusPipeline` pattern:

```
[● development (5)]  [● main (2)]  [● release/v2.1 (1)]
```

- `rounded-full border px-3 py-1.5 text-sm`
- Dot color: `bg-blue-500` for all branches (neutral — branch is a category, not a status)
- Active/inactive toggle classes match `GROUP_STATUS_CONFIG` pattern
- Selecting a branch loads its PRs and watch state
- Only one branch active at a time (radio behavior, not multi-select)

#### WatchStatusCard

When **no active watch** for the selected branch:

```
[Start Watching]  ← primary Button component
```

When **active**:

```
┌─ Card variant: border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/30 ─┐
│  ⟳ (Loader2 animate-spin) Active                                                     │
│  Merged: 3 · Skipped: 2 · Last tick: 45s ago                                         │
│                                                          [Stop Watching] (danger btn) │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Matches the progress card pattern from `CodeTaskViewPageV2`.

When **drained**:

```
┌─ Card variant: border-emerald-200 bg-emerald-50 ────────────────────────────────────┐
│  ✓ (CheckCircle2) Drained                                                            │
│  Merged: 7 · Completed 3 min ago                                                     │
│                                                         [Start Again] (secondary btn) │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

#### StatusPipeline (PR filter pills)

```
[● Mergeable 2]  [● Pending 1]  [● Blocked 2]
```

Exact same component pattern as Code Tasks `StatusPipeline`:

| Filter    | dotClass       | activeClass pattern                               |
| --------- | -------------- | ------------------------------------------------- |
| Mergeable | `bg-green-500` | `border-green-500 bg-green-50 text-green-700 ...` |
| Pending   | `bg-amber-500` | `border-amber-500 bg-amber-50 text-amber-700 ...` |
| Blocked   | `bg-red-500`   | `border-red-500 bg-red-50 text-red-700 ...`       |

Multi-select toggle (same as Code Tasks).

#### SortSelector

```
Sort: [Oldest] [Newest] [PR#]
```

`ArrowUpDown` icon + `rounded-full border px-2.5 py-1 text-xs` pills. Same as Code Tasks `SortSelector`.

#### ColumnHeader

```
hidden lg:grid grid-cols-[60px_1fr_120px_100px_100px] px-4
text-xs font-medium uppercase tracking-wider text-slate-500
```

Columns: `PR#` | `Title` | `Author` | `Status` | `Checks`

#### PR Rows (card rows — IssueGroupRow pattern)

```
rounded-lg border bg-white px-4 py-3 text-sm transition-shadow
hover:shadow-md dark:border-slate-700 dark:bg-slate-800
+ inset accent shadow
```

Accent shadows:
- Mergeable → `shadow-[inset_3px_0_0_theme(colors.green.500)]`
- Pending → `shadow-[inset_3px_0_0_theme(colors.amber.500)]`
- Blocked → `shadow-[inset_3px_0_0_theme(colors.red.500)]`

Desktop: `hidden lg:grid grid-cols-[60px_1fr_120px_100px_100px] items-center gap-2`
Mobile: `flex flex-col gap-2 lg:hidden`

Status + Checks rendered as small `rounded-full px-2.5 py-1 text-sm font-medium` badges using the STATUS_MAP color pattern.

Non-eligible author PRs shown with reduced opacity (`opacity-50`) and a tooltip: "Not eligible — authored by {author}".

#### MergeHistoryTimeline (IssueTimeline pattern)

Below the PR list. Collapsible section.

```
border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-zinc-700
```

Timeline with `border-l-2 border-slate-300 pl-2`:

```
● #1335 — feat: add caching · merged 8 min ago
● #1336 — fix: null check    · merged 5 min ago
● #1337 — chore: bump deps   · merged 2 min ago
```

Dot: `bg-emerald-500 rounded-full h-2.5 w-2.5`

## Error Handling

- **Token expired:** Tick marks watch with `error` action, does not transition status. Next tick retries.
- **Rate limited:** Tick backs off, returns `error` action with reason.
- **Merge conflict at merge time** (race condition — was clean, now conflicting): Skip the PR, record `merge_conflict`, continue to next.
- **Watch creator deleted/deactivated:** Token resolution fails, watch stays active but errors until manually cancelled.

## Testing

- **Tick use case:** Unit tests with fake GitHubPRClient. Test: merge oldest eligible, skip ineligible authors, skip conflicting, drain when empty, stay active when skipped PRs remain.
- **Watch CRUD routes:** `app.inject()` tests for create (happy + duplicate 409), delete, list.
- **Tick route:** `app.inject()` with internal auth validation.
- **Author filtering:** Verify only watch creator + bot PRs are eligible.
