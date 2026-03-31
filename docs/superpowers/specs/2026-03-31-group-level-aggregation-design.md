# Group-Level Firestore Aggregation Design

**Goal:** Eliminate the unbounded Firestore fetch in `GET /code/issue-groups` by precomputing group-level aggregate state at write time.

**Problem:** The endpoint fetches ALL non-archived tasks for a user (538 docs, 572ms, 4MB) on every page load just to compute group counts for filter badges and paginate groups. This is O(total_tasks) and grows linearly.

**Measured baseline (production Firestore, 2026-03-30):**

| Operation                                     | Time        | Data                             |
| --------------------------------------------- | ----------- | -------------------------------- |
| `listAllNonArchived` (unbounded, 9-status IN) | 572ms       | 538 docs, 4MB                    |
| Linear hydration (104 issues, 4 seq chunks)   | 570ms       | 91 issues found                  |
| **Total end-to-end**                          | **1,150ms** | Firestore only, no HTTP overhead |
| Limited query (51 docs) for comparison        | 101ms       | 384KB                            |

---

## New Collections

### `task_group_summaries/{userId}_{groupKey}`

One document per (userId, groupKey). The `groupKey` is `linearIssueId` for linked tasks or `standalone_{taskId}` for orphan tasks.

```
{
  userId: string,
  linearIssueId: string | null,
  groupKey: string,

  // Aggregate fields (maintained incrementally)
  taskCount: number,                // non-archived tasks in group
  activeTaskCount: number,          // tasks with status in {queued, dispatched, running}
  latestTaskStatus: string,         // status of most-recently-updated non-archived task
  latestTaskUpdatedAt: Timestamp,   // updatedAt of that task
  agentTypesPresent: string[],      // distinct agentType values
  hasCompletedPlanning: boolean,    // any planning task with status 'planned'
  hasCompletedExecution: boolean,   // any execution task with status 'implemented' or 'reviewed'
  hasImplementationTaskId: boolean, // any task has implementationTaskId set
  hasPrUrl: boolean,                // any task has result.prUrl
  prNumber: number | null,          // PR number from first task with result.prUrl
  latestReviewNeedsRemediation: boolean | null,  // from latest review task's result.needs_remediation

  // Sort key fields
  oldestTaskCreatedAt: Timestamp,   // for created-time sort
  mostRecentDispatchedAt: Timestamp | null,  // for started-time sort

  // Precomputed group status
  aggregateStatus: 'active' | 'needs-action' | 'done' | 'failed',

  updatedAt: Timestamp,
}
```

### `user_group_counts/{userId}`

One document per user. Updated atomically via `FieldValue.increment()`.

```
{
  userId: string,
  active: number,
  needsAction: number,
  done: number,
  failed: number,
  totalGroups: number,
  updatedAt: Timestamp,
}
```

---

## Aggregate Status Derivation (Simplified)

The precomputed `aggregateStatus` uses a pessimistic heuristic for "needs-action" since Linear labels are not available at write time:

```
if (activeTaskCount > 0):
  return 'active'

if (hasCompletedPlanning && !hasCompletedExecution && !hasImplementationTaskId):
  return 'needs-action'   // assumes implementation-ready label present

if (hasCompletedExecution && hasPrUrl):
  // Check if latest review indicates no remediation needed
  if (latestReviewNeedsRemediation === false):
    return 'needs-action'   // assumes merge-ready label present

if (latestTaskStatus in {'failed', 'interrupted'}):
  return 'failed'

return 'done'
```

**Staleness trade-off (accepted):** The "needs-action" count may overcount by 1-2 when a Linear label hasn't been set yet. The actual page data (groups on screen) uses live Linear hydration and shows the correct status.

---

## Write Path: Repository Decorator

A wrapper around `CodeTaskRepository` that intercepts the 3 write methods:

### Intercepted Methods

| Method         | Trigger             | Summary Action                                                   |
| -------------- | ------------------- | ---------------------------------------------------------------- |
| `create()`     | New task created    | Add task to group summary; if new group, increment `totalGroups` |
| `update()`     | Task status changed | Update group summary with delta; recompute aggregate status      |
| `deleteTask()` | Task removed        | Remove task from group summary; if group empty, delete summary   |

### Decorator Structure

```typescript
// New file: apps/code-agent/src/infra/repositories/codeTaskRepositoryWithGroupUpdates.ts

export function withGroupUpdates(
  inner: CodeTaskRepository,
  groupSummaryRepo: TaskGroupSummaryRepository,
  logger: Logger,
): CodeTaskRepository {
  return {
    ...inner,  // Pass through all read methods unchanged

    create: async (input, options) => {
      const result = await inner.create(input, options);
      if (result.ok) {
        void updateSummaryAfterCreate(groupSummaryRepo, result.value, logger);
      }
      return result;
    },

    update: async (taskId, input) => {
      // Extra read to capture old task state (accepted trade-off: ~80ms)
      const oldTask = await inner.findById(taskId);
      const result = await inner.update(taskId, input);
      if (result.ok && oldTask.ok && input.status !== undefined) {
        void updateSummaryAfterStatusChange(
          groupSummaryRepo, oldTask.value, result.value, logger
        );
      }
      return result;
    },

    deleteTask: async (taskId, userId) => {
      const oldTask = await inner.findByIdForUser(taskId, userId);
      const result = await inner.deleteTask(taskId, userId);
      if (result.ok && oldTask.ok) {
        void updateSummaryAfterDelete(groupSummaryRepo, oldTask.value, logger);
      }
      return result;
    },
  };
}
```

**Fire-and-forget:** Summary updates use `void` — failures are logged as warnings but do not affect the original task operation.

### Summary Update Logic

On each write:
1. Determine `groupKey` from the task's `linearIssueId` (or `standalone_{taskId}`)
2. Use a Firestore transaction to:
   - Read `task_group_summaries/{userId}_{groupKey}`
   - Apply delta (e.g., status `running` → `planned`: decrement `activeTaskCount`, update `latestTaskStatus`)
   - Recompute `aggregateStatus` from updated fields
   - If `aggregateStatus` changed from old value: update `user_group_counts/{userId}` with `FieldValue.increment(-1)` for old status and `FieldValue.increment(1)` for new status
   - Write both docs

The transaction scope is small (2 docs: the group summary and the user counts). Contention is low because tasks within the same group rarely update concurrently (active-task dedup prevents it).

### Edge Cases

| Case                                          | Handling                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| First task in a group                         | Create summary doc, increment `user_group_counts.totalGroups`                                              |
| Last task deleted/archived from group         | Delete summary doc, decrement `user_group_counts.totalGroups` and the relevant status count                |
| Standalone task (no linearIssueId)            | Gets its own summary doc keyed by `standalone_{taskId}`                                                    |
| Task moves to `archived`                      | Treated as removal from the active group (decrement `taskCount`); if `taskCount` reaches 0, delete summary |
| `create()` with `initialStatus: 'dispatched'` | Summary gets `activeTaskCount: 1` from the start                                                           |

---

## Read Path: Optimized Endpoint

### Before (current)

```
GET /code/issue-groups
→ listAllNonArchived(userId)           // 538 docs, 572ms
→ serialize + extract linearIssueIds   // 104 unique
→ fetchIssuesForDisplay(104 issues)    // 570ms
→ groupByLinearIssue(tasks)            // in-memory
→ count groups per status              // in-memory
→ filter → sort → paginate            // return 20 groups
```

### After

```
GET /code/issue-groups
→ read user_group_counts/{userId}              // 1 doc, ~10ms (for badges)
→ query task_group_summaries                   // ~50ms
    WHERE userId == X
    AND aggregateStatus IN [statusFilter]
    ORDER BY updatedAt DESC
    LIMIT 20
→ for 20 groups: fetch code_tasks              // ~100ms
    WHERE linearIssueId IN [20 ids]
    AND userId == X
    AND status IN NON_ARCHIVED_STATUSES
→ fetchIssuesForDisplay(20 issues)             // ~150ms (1 chunk, not 4)
→ groupByLinearIssue(tasks)                    // in-memory, ~100 tasks max
→ return groups with precomputed counts
```

**Estimated total: ~310ms** (down from 1,150ms). Growth is O(page_size), not O(total_tasks).

### Sorting

The endpoint supports 4 sort options: `linear-id`, `pr-number`, `created-time`, `started-time`. The `task_group_summaries` docs need to store enough data for all sort keys:

- `linear-id`: derived from `linearIssueId` (already stored)
- `pr-number`: store `prNumber` on the summary doc
- `created-time`: store `oldestTaskCreatedAt` on the summary doc
- `started-time`: store `mostRecentDispatchedAt` on the summary doc

Each sort requires a composite Firestore index: `(userId, aggregateStatus, <sortField>)`.

---

## Firestore Indexes

```javascript
// Migration: task_group_summaries indexes
{
  collectionGroup: 'task_group_summaries',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'userId', order: 'ASCENDING' },
    { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
    { fieldPath: 'updatedAt', order: 'DESCENDING' },
  ],
}
```

Additional indexes per sort option (can be added incrementally as sort options are used).

---

## Service Wiring

In `apps/code-agent/src/services.ts` (line 339):

```typescript
const rawCodeTaskRepo = createFirestoreCodeTaskRepository({ firestore, logger });
const groupSummaryRepo = createTaskGroupSummaryFirestoreRepository({ firestore, logger });
const codeTaskRepo = withGroupUpdates(rawCodeTaskRepo, groupSummaryRepo, logger);
```

The rest of the app sees the same `CodeTaskRepository` interface — no caller changes needed.

---

## Backfill Migration

A standalone script that:
1. Reads all tasks via `listAllNonArchived(userId)` (one-time cost)
2. Groups by `(userId, linearIssueId)`
3. Computes summary fields for each group
4. Writes `task_group_summaries` docs in batches of 500
5. Computes and writes `user_group_counts` docs
6. Idempotent (`set` with merge)

With 1,577 tasks yielding ~104 groups, this completes in seconds.

---

## Rollout Strategy

### Phase 1: Shadow Write (no read changes)
Deploy decorator. All task writes now maintain summaries as a side-effect. Monitor for errors. Endpoint still uses unbounded fetch.

### Phase 2: Backfill
Run migration script to populate summaries for existing data. Validate counts match full-fetch counts.

### Phase 3: Switch Endpoint
Update `issueGroupRoutes.ts` to read from summaries. Deploy behind `GROUP_SUMMARIES_ENABLED` env var. Temporary dual-read validation logs discrepancies.

### Phase 4: Cleanup
Remove feature flag, remove dual-read, remove `listAllNonArchived` from the endpoint code.

---

## Files Modified/Created

### New Files
| File                                                           | Purpose                                          |
| -------------------------------------------------------------- | ------------------------------------------------ |
| `src/domain/models/taskGroupSummary.ts`                        | Types for summary and counts docs                |
| `src/domain/ports/taskGroupSummaryRepository.ts`               | Repository port interface                        |
| `src/infra/firestore/taskGroupSummaryFirestoreRepository.ts`   | Firestore implementation                         |
| `src/infra/repositories/codeTaskRepositoryWithGroupUpdates.ts` | Decorator with write hooks                       |
| `src/domain/issueGrouping/deriveAggregateStatusFromSummary.ts` | Simplified status derivation from summary fields |
| `src/scripts/backfillGroupSummaries.ts`                        | One-time migration script                        |
| Tests for each of the above                                    |

### Modified Files
| File                                  | Change                                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| `src/services.ts` (line 339)          | Wrap `codeTaskRepo` with `withGroupUpdates`                |
| `src/routes/code/issueGroupRoutes.ts` | Rewrite to read from summaries instead of unbounded fetch  |
| `migrations/`                         | New migration for `task_group_summaries` composite indexes |

### Unchanged
| File                                | Why                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `firestoreCodeTaskRepository.ts`    | Decorator wraps it; no internal changes                                |
| `codeTaskRepository.ts` (interface) | Decorator implements same interface                                    |
| `groupByLinearIssue.ts`             | Still used for page-level grouping of fetched tasks                    |
| All 14+ status change callers       | They call `codeTaskRepo.update()` which is now decorated transparently |

---

## Additional Optimization (Bundled)

While changing `issueGroupRoutes.ts`, also parallelize the Linear hydration chunks in `linearIssueRepository.ts:174` (`for` loop → `Promise.all`). Measured: 355ms sequential → 262ms parallel, a 26% improvement on the hydration step. This is a 1-line change in `apps/linear-agent/src/infra/firestore/linearIssueRepository.ts`.
