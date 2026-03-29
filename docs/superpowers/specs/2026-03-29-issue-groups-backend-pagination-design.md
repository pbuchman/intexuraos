# Issue Groups Backend Pagination (Code Tasks V3)

**Date:** 2026-03-29
**Status:** Draft

## Problem

The current code tasks list (`GET /code/tasks`) returns flat, task-level paginated results. Grouping by Linear issue, filtering by group status, sorting, and aggregate status computation all happen client-side. This causes:

1. **Inaccurate counts** — filter badges reflect only loaded tasks (50 per page), not the full dataset (1,507 tasks across 426 issue groups)
2. **Refresh collapses loaded pages** — `refresh()` fetches only page 1 (50 tasks, no cursor), discarding pages 2+ that the user loaded via "Load More"
3. **Incomplete groups** — issue groups can be split across page boundaries; a group's aggregate status may be wrong if some of its tasks are on an unloaded page
4. **27 clicks to see everything** — 50 tasks/page across 1,362 non-archived tasks

## Constraints

- **No modifications to existing code.** The current endpoint, hook, page, and utilities remain untouched. All new code lives in new files.
- **New duplicate view.** A parallel page at `/code-tasks-v3` (hidden, no sidebar nav entry) with a new backend endpoint.
- **Existing components may be imported**, not copied. `IssueGroupRow`, `CodeTaskLogsModal`, `Layout`, etc. are reused.
- **Archived tasks excluded (v1).** The backend query excludes archived tasks entirely. The current `CodeTasksPage` supports an "Archived" filter tab, so v3 has a parity gap here. Before v3 replaces the default view, an `archived` value must be added to `groupStatus` (or a separate `includeArchived` flag). This is explicitly scoped as a follow-up — see "Future Work" section.

## Design

### New Endpoint: `GET /code/issue-groups`

**Auth:** JWT (same as existing endpoints)

**Query Parameters:**

| Param         | Type            | Default          | Description                                                        |
| ------------- | --------------- | ---------------- | ------------------------------------------------------------------ |
| `groupStatus` | comma-separated | all non-archived | Filter: `active`, `needs-action`, `done`, `failed`                 |
| `sortBy`      | string          | `linear-id`      | One of: `linear-id`, `pr-number`, `created-time`, `started-time`   |
| `limit`       | number          | 20               | Groups per page (max 100)                                          |
| `cursor`      | string          | (none)           | Opaque cursor token for group-level pagination (see Cursor Design) |

**Response:**

```json
{
  "groups": [
    {
      "linearIssueId": "INT-445",
      "linearIssue": {
        "identifier": "INT-445",
        "parentIdentifier": null,
        "title": "Add retry logic to webhook handler",
        "state": { "name": "In Progress", "type": "started" },
        "priority": 2,
        "assignee": { "id": "...", "name": "..." },
        "labels": [{ "id": "...", "name": "ready-to-implement" }],
        "url": "https://linear.app/...",
        "commentCount": 3,
        "lastCommentAt": "2026-03-28T..."
      },
      "aggregateStatus": "needs-action",
      "pipeline": {
        "steps": [
          { "agentType": "planning", "state": "completed", "label": "Planning" },
          { "agentType": "execution", "state": "actionable", "label": "Execution" }
        ],
        "pr": { "url": "https://github.com/.../pull/42", "number": "42" },
        "failedAttempts": 1,
        "archivedCount": 0
      },
      "latestTask": { "...full serialized CodeTask..." },
      "tasks": ["...all tasks in this group, sorted by createdAt asc..."],
      "mostRecentDispatchedAt": "2026-03-28T10:30:00.000Z"
    }
  ],
  "counts": {
    "active": 3,
    "needs-action": 5,
    "done": 380,
    "failed": 2
  },
  "totalGroups": 390,
  "nextCursor": "eyJpbmRleCI6MjB9"
}
```

**`counts`** reflects ALL non-archived groups (before filtering), so filter badges are always accurate.

**`totalGroups`** is the count of groups matching the current `groupStatus` filter (after filtering, before pagination).

### Backend Flow

1. **Fetch all non-archived tasks:** `.where('userId', '==', userId).where('status', 'in', NON_ARCHIVED_STATUSES).orderBy('createdAt', 'desc')` — no limit, no cursor
2. **Serialize:** Run `taskToApiResponse()` on all tasks to convert Firestore Timestamps to ISO strings
3. **Hydrate Linear labels:** Batch fetch for unique `linearIssueId` values (same pattern as existing endpoint)
4. **Attach Linear data:** Merge hydrated issue data onto serialized tasks
5. **Group:** `groupByLinearIssue(serializedTasks)` — produces `IssueGroup[]` with pipeline, aggregateStatus, etc.
6. **Compute global counts:** Count groups per aggregateStatus (before filtering)
7. **Filter:** Apply `groupStatus` param
8. **Sort:** Apply `sortBy` param
9. **Paginate:** Decode cursor to get start index, slice `[startIndex, startIndex + limit]`
10. **Encode next cursor:** If more groups remain, encode `{ index: startIndex + limit }`

### Backend — Grouping Logic (New Files)

All new files in `apps/code-agent/src/domain/issueGrouping/`:

| File                    | Purpose                                                                                                     | Ported from                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `types.ts`              | `IssueGroup`, `PipelineState`, `PipelineStepData`, `GroupStatus`, `SortOption`, `StepState`                 | `apps/web/src/utils/issueGroups.ts` lines 1-29    |
| `groupByLinearIssue.ts` | Main grouping function + `derivePipeline` + `deriveAggregateStatus`                                         | `apps/web/src/utils/issueGroups.ts` lines 157-389 |
| `sortIssueGroups.ts`    | Sort functions + `parseLinearIssueNumber`                                                                   | `apps/web/src/utils/issueGroups.ts` lines 391-456 |
| `labelHelpers.ts`       | `hasImplementationReadyLabel`, `hasMergeReadyLabel`, `normalizeLabel`, `isTaskMergeable`, `getTaskMergeUrl` | `apps/web/src/utils/issueGroups.ts` lines 70-155  |
| `constants.ts`          | `ACTIVE_STATUSES`, `AGENT_TYPE_LABELS`, `NON_ARCHIVED_STATUSES`                                             | Various                                           |
| `index.ts`              | Barrel export                                                                                               | —                                                 |

These operate on **serialized API-shaped tasks** (ISO string dates), not Firestore domain objects. This makes the port a near-copy of the frontend code.

### Backend — Repository Method

New method on `codeTaskRepo`:

```typescript
listAllNonArchived(userId: string): Promise<Result<CodeTask[], RepositoryError>>
```

- Queries: `.where('userId', '==', userId).where('status', 'in', NON_ARCHIVED_STATUSES).orderBy('createdAt', 'desc')`
- No limit, no cursor — returns all matching documents
- `NON_ARCHIVED_STATUSES`: `['queued', 'dispatched', 'running', 'planned', 'implemented', 'reviewed', 'failed', 'interrupted', 'cancelled']` (9 values, within Firestore's 30-value `in` limit)

### Backend — Cursor Design

**Why index-based cursors are acceptable here:**

The backend re-fetches and re-groups all non-archived tasks on every request (steps 1-8). Each request produces a fresh, deterministic group array. The cursor is used to slice into *that specific request's* result set. Unlike traditional database cursors where rows can be inserted between pages, here the full dataset is recomputed per-request, so index-based pagination is internally consistent.

However, between a "page 1" and "Load More page 2" request, the underlying tasks may change (new tasks dispatched, statuses updated). This means groups can shift positions — a group at index 20 in request 1 may be at index 19 in request 2. This is an accepted trade-off: worst case, the user sees a duplicate group or skips one. The `mergeGroups()` function on the frontend deduplicates by `linearIssueId`, so duplicates are harmless. Skipped groups appear on refresh.

**Cursor encoding:**

```typescript
function encodeCursor(index: number): string {
  return Buffer.from(JSON.stringify({ index })).toString('base64url');
}

function decodeCursor(cursor: string): { index: number } {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString());
}
```

Base64url-encoded JSON. The cursor represents the position in the sorted+filtered group list. On refresh (no cursor), pagination starts from index 0.

**Future consideration:** If cursor drift proves problematic in practice, the cursor can be upgraded to keyset-based (encoding the last group's sort key + `linearIssueId` tiebreaker) without changing the opaque contract — the frontend treats cursors as opaque strings.

### Frontend — New Hook: `useIssueGroups.ts`

**Location:** `apps/web/src/hooks/useIssueGroups.ts`

**State:**

```typescript
groups: IssueGroup[]
counts: Record<GroupStatus, number>
totalGroups: number
loading: boolean
loadingMore: boolean
refreshing: boolean
error: string | null
hasMore: boolean
```

**Parameters:**

```typescript
function useIssueGroups(options: {
  groupStatus?: GroupStatus[];
  sortBy?: SortOption;
}): { ... }
```

**Key behaviors:**

- **Initial load:** `listIssueGroups(token, { groupStatus, sortBy, limit: 20 })`
- **Load more:** `listIssueGroups(token, { groupStatus, sortBy, limit: 20, cursor })` — appends groups
- **Refresh:** Multi-request refill when loaded groups exceed `limit`. The hook tracks `loadedGroupCount` (number of groups currently displayed). On refresh:
  1. If `loadedGroupCount <= 100`: single request with `limit: Math.max(loadedGroupCount, 20)`, no cursor.
  2. If `loadedGroupCount > 100`: sequential requests of `limit: 100` each, using cursors, until `loadedGroupCount` groups are fetched or no more pages remain.

  Each batch is merged via `mergeGroups()` for reference preservation. This ensures refresh always honors the documented max limit of 100.
- **Filter/sort change:** Resets to page 1, triggers fresh fetch with new params
- **Polling:** 30s interval when `counts.active > 0`, tab visibility refresh
- **Rapid polling:** 3s for 30s after user actions (same pattern as current)

**`mergeGroups()` function:**

Compares groups by `linearIssueId ?? latestTask.id`. Preserves reference if `aggregateStatus` and `latestTask.updatedAt` are unchanged. Same pattern as existing `mergeTasks()`.

### Frontend — New API Client: `services/codeAgentApiV3.ts`

```typescript
export async function listIssueGroups(
  accessToken: string,
  options?: {
    groupStatus?: GroupStatus[];
    sortBy?: SortOption;
    limit?: number;
    cursor?: string;
  }
): Promise<ListIssueGroupsResponse>
```

Uses `apiRequest<ListIssueGroupsResponse>()` with query param construction via `URLSearchParams`. Follows the same pattern as existing `codeAgentApi.ts`.

### Frontend — New Types: `types/issueGroups.ts`

Defines the API response types:

```typescript
export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed';
export type SortOption = 'linear-id' | 'pr-number' | 'created-time' | 'started-time';
export type StepState = 'completed' | 'running' | 'dispatched' | 'queued' | 'failed' | 'waiting' | 'actionable';

export interface PipelineStepData {
  agentType: string;
  state: StepState;
  label: string;
}

export interface PipelineState {
  steps: PipelineStepData[];
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
  mostRecentDispatchedAt?: string;
}

export interface ListIssueGroupsResponse {
  groups: IssueGroup[];
  counts: Record<GroupStatus, number>;
  totalGroups: number;
  nextCursor?: string;
}
```

These types match the `IssueGroup` interface used by `IssueGroupRow`, enabling direct reuse of that component.

### Frontend — New Page: `CodeTasksPageV3.tsx`

**Location:** `apps/web/src/pages/CodeTasksPageV3.tsx`

Structurally similar to `CodeTasksPage.tsx` but simpler:

**Keeps (imports from existing components):**
- `IssueGroupRow` — renders each group row
- `CodeTaskLogsModal` — log preview modal
- `Layout` — app shell
- `Button` — UI component

**Removes (backend handles these):**
- `groupByLinearIssue()` — backend groups
- `sortIssueGroups()` — backend sorts
- `allGroups` / `filteredGroups` / `counts` useMemo chains — uses backend response directly
- `apiStatuses` computation — replaced by `groupStatus` param
- `ACTIVE_STATUSES` import — uses `counts.active > 0`

**Changes:**
- Filter/sort toggling triggers `useIssueGroups` re-fetch (server round-trip)
- Counts come from response (`counts` field), always accurate
- `timeTick` enabled when `counts.active > 0`
- `PageHeader` receives counts from response

**Reuses inline (copied from CodeTasksPage, adapted):**
- `PageHeader` — updated to use backend counts
- `StatusPipeline` — same filter chip UI
- `SortSelector` — same sort button UI
- `ColumnHeader` — same column headers
- localStorage persistence for filters/sort (new keys: `code-tasks-v3-group-filter`, `code-tasks-v3-sort`)

### Route Registration

**Backend:** One-line addition to `apps/code-agent/src/routes/index.ts`:

```typescript
await app.register(issueGroupRoutes, deps);
```

The new route file (`src/routes/code/issueGroupRoutes.ts`) exports a `FastifyPluginCallback<CodeRoutesOptions>` following the same pattern as `githubPREventsRoute`, `githubEventLogRoute`, etc.

**Frontend:** One-line addition to `apps/web/src/App.tsx`:

```tsx
<Route path="/code-tasks-v3" element={<ProtectedRoute><CodeTasksPageV3 /></ProtectedRoute>} />
```

No sidebar navigation entry. Accessible by direct URL only.

### Existing Files Modified (Minimal)

Only two existing files are touched, both with single-line additions:

| File                                  | Change                                     |
| ------------------------------------- | ------------------------------------------ |
| `apps/code-agent/src/routes/index.ts` | Add `app.register(issueGroupRoutes, deps)` |
| `apps/web/src/App.tsx`                | Add `<Route>` for `/code-tasks-v3`         |

No existing behavior is changed.

## Endpoint Changes

### Created
- `GET /code/issue-groups` — new endpoint for group-level paginated results

### Modified
- None

### Removed
- None

### Unchanged
- `GET /code/tasks` — existing flat task pagination (stays untouched)
- `POST /code/retry` — retry endpoint (used by action handler)
- `POST /code/implement` — implement endpoint (used by action handler)
- `DELETE /code/tasks/:taskId` — delete endpoint (used by action handler)

## Testing

### Backend

**Route integration test:** `src/__tests__/routes/code/issueGroups.test.ts`
- Grouping: tasks with same `linearIssueId` in one group
- Aggregate status: active > needs-action > failed > done priority
- Pipeline derivation: steps, actionable detection, PR extraction
- Filtering: `?groupStatus=active,needs-action` excludes done/failed
- Sorting: all 4 options produce correct ordering
- Pagination: cursor returns correct next page, `hasMore` accuracy
- Counts: reflect ALL groups, not just current page
- Linear hydration: groups contain hydrated issue data
- Empty state: no tasks returns empty groups + zero counts
- Edge cases: tasks without `linearIssueId` (standalone groups), mixed statuses

**Grouping logic unit tests:** `src/__tests__/domain/issueGrouping/`
- `groupByLinearIssue.test.ts` — grouping, pipeline, aggregate status
- `sortIssueGroups.test.ts` — all sort options, edge cases
- `labelHelpers.test.ts` — implementation-ready and merge-ready label detection

### Frontend

- `useIssueGroups.test.ts` — initial load, loadMore, refresh with expanded limit, mergeGroups reference preservation, filter/sort param changes trigger re-fetch, polling behavior
- `CodeTasksPageV3.test.ts` — rendering, filter interaction, sort interaction, load more, action handlers, empty state

**Coverage:** 100% branch coverage required (per CLAUDE.md).

## New Files Summary

### Backend (`apps/code-agent/`)
| File                                                            | Purpose                                    |
| --------------------------------------------------------------- | ------------------------------------------ |
| `src/domain/issueGrouping/types.ts`                             | Type definitions                           |
| `src/domain/issueGrouping/groupByLinearIssue.ts`                | Grouping + pipeline + aggregate status     |
| `src/domain/issueGrouping/sortIssueGroups.ts`                   | Sort functions                             |
| `src/domain/issueGrouping/labelHelpers.ts`                      | Label detection helpers                    |
| `src/domain/issueGrouping/constants.ts`                         | Status sets, agent type labels             |
| `src/domain/issueGrouping/index.ts`                             | Barrel export                              |
| `src/routes/code/issueGroupRoutes.ts`                           | Route handler for `GET /code/issue-groups` |
| `src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts` | Unit tests                                 |
| `src/__tests__/domain/issueGrouping/sortIssueGroups.test.ts`    | Unit tests                                 |
| `src/__tests__/domain/issueGrouping/labelHelpers.test.ts`       | Unit tests                                 |
| `src/__tests__/routes/code/issueGroups.test.ts`                 | Integration tests                          |

### Frontend (`apps/web/`)
| File                                          | Purpose                              |
| --------------------------------------------- | ------------------------------------ |
| `src/types/issueGroups.ts`                    | API response types                   |
| `src/services/codeAgentApiV3.ts`              | API client for new endpoint          |
| `src/hooks/useIssueGroups.ts`                 | Hook for group-level data management |
| `src/pages/CodeTasksPageV3.tsx`               | New page component                   |
| `src/__tests__/hooks/useIssueGroups.test.ts`  | Hook tests                           |
| `src/__tests__/pages/CodeTasksPageV3.test.ts` | Page tests                           |

## Future Work (Not In Scope)

- **Archived group status support** — add `archived` as a valid `groupStatus` value so v3 achieves filter parity with the current view before it replaces `CodeTasksPage` as the default. Required before sidebar navigation swap.
- **Auto-archive merged tasks after 7 days** — background job that archives tasks with merged PRs, reducing the active document count (tracked separately in Linear)
- **Archived tasks UI** — separate view/section for browsing archived tasks
- **Denormalized `code_task_groups` collection** — pre-computed group index for O(1) group queries (Option A from initial analysis), justified when task counts grow further
- **Sidebar navigation swap** — replace old code tasks link with v3 when validated
- **Remove old code path** — delete `CodeTasksPage`, `useCodeTasks`, `issueGroups.ts`, and `GET /code/tasks` endpoint once v3 is stable
