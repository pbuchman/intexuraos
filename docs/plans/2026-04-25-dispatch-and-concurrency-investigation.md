# Dispatch + Concurrency Failures — Investigation, Evidence, and Fix Plan

> **Status:** investigation + plan only. No code changes shipped here.
> **Sibling investigation:** `docs/plans/INT-1560-failed-subtasks-investigation.md` (the parser-side failure mode, which is fixed in PR #1966 — `fix(orchestrator): NDJSON-aware fallback in locateFinalBlock`).
> **Linear issue:** _user creates on push._

---

## 1. Problem statement

The 2026-04-24 fan-out (10 INT-1473 children + 5 INT-1472 children dispatched at 20:44:38Z) exposed three observable symptoms in the `apps/code-agent` ↔ `workers/orchestrator` task pipeline:

1. **Capacity rejection becomes terminal failure.** When the dispatcher returns `worker_unavailable` (all worker health probes failed), `drainTaskQueue` finalises the task as `failed` instead of keeping it queued. There is no retry or back-pressure — a 5-second tunnel hiccup or a brief Cloud Run cold-start storm permanently kills the task.
2. **Plan ↔ review concurrent execution on the same Linear issue.** Reviews are dispatched against a PR while the planning task that *created* that PR is still running. The chain explodes: each retry of planning pushes more commits → GitHub `synchronize` webhook → another review enqueued → another concurrent dispatch.
3. **Plan-review oscillation.** Each affected Linear issue ended up with 7-9 alternating planning/review tasks before the final task hit `worker_unavailable` and died. This is a *consequence* of the two bugs above — not an independent failure mode.

The user-facing requirement is unambiguous: **when there are no workers available, the task must stay in the queue, never fail.** The plan ↔ review interleave is the second concrete bug; the oscillation is an emergent symptom.

---

## 2. Evidence

### 2.1 Aggregate failure pattern

15 affected Linear issues from INT-1560 (INT-1483, INT-1486, INT-1520, INT-1524, INT-1525, INT-1529-INT-1538). Querying Firestore (`code_tasks` collection, `where linearIssueId == <issue>`):

| Issue    | # tasks | Final task | Final code                |
| -------- | ------- | ---------- | ------------------------- |
| INT-1483 | 3       | review     | `worker_unavailable`      |
| INT-1486 | 2       | planning   | `worker_unavailable`      |
| INT-1520 | 3       | planning   | `worker_unavailable`      |
| INT-1524 | 5       | planning   | `TASK_RUNTIME_HARD_ERROR` |
| INT-1525 | 5       | planning   | `worker_unavailable`      |
| INT-1529 | 9       | planning   | `worker_unavailable`      |
| INT-1530 | 7       | review     | `worker_interrupted`      |
| INT-1531 | 8       | review     | `worker_unavailable`      |
| INT-1532 | 8       | planning   | `worker_unavailable`      |
| INT-1533 | 9       | planning   | `worker_unavailable`      |
| INT-1534 | 8       | review     | `worker_unavailable`      |
| INT-1535 | 7       | review     | `worker_unavailable`      |
| INT-1536 | 8       | review     | `worker_unavailable`      |
| INT-1537 | 8       | review     | `worker_unavailable`      |
| INT-1538 | 8       | planning   | `worker_unavailable`      |

**12 of 15 chains end with `worker_unavailable`** (Fix A target). The 3 outliers (INT-1524, INT-1530, plus the parser-side cases fixed in PR #1966) are dominated by the parser bug or interrupted by manual cancellation.

### 2.2 Timeline of one chain (INT-1529, full reconstruction from Firestore)

```
20:44:38  user dispatches 9 INT-1473 children simultaneously (massive fan-out)
20:44:38  planning task_70aad67f starts (Linear=INT-1529, prNumber=undefined)
20:50:??  planning agent creates PR #1951 and pushes plan doc
            (NB: prNumber is NEVER stamped on the planning task document)
20:54:17  GitHub fires `synchronize` webhook → unifiedEvaluator triages →
            review task_b1152800 enqueued with prNumber=1951
20:54:1?  drainTaskQueue runs → checks `dispatchedOrRunningForPR(repo, PR=1951)`
            → returns {hasActive: false} (planning task's prNumber is undefined → query miss)
20:54:1?  review dispatched in parallel with planning. PR-level guard bypassed.
20:55:57  planning fails → TASK_RUNTIME_HARD_ERROR (NDJSON-buried marker — fixed in PR #1966)
20:55:57  triageFailedTask → classifyFailure(TASK_RUNTIME_HARD_ERROR) → 'retry'
            → autoRetryTask creates planning task_f481e9aa with retriedFrom=task_70aad67f
…
LOOP REPEATS 4 times (each planning fails, each push fires a synchronize → new review)
…
22:13:25  final retry planning task_437cda4b dispatches
            → All worker health probes fail → taskDispatcher returns code='worker_unavailable'
22:13:25  drainTaskQueue.ts:518 → `dispatchError.code !== 'at_capacity'` → marks task as `failed`.
            Task is NOT requeued. End of chain.
```

Live Firestore data confirms the `prNumber=undefined` gap on planning tasks even at the end of the run:

```
task_70aad67f-2685-4c2f-b1cf-506dc1925a52 agent=planning status=archived prNumber=undefined  20:44:38 → 20:55:57
task_b1152800-bf4f-4071-ac9f-a05e1a57d192 agent=review   status=archived prNumber=1951       20:54:17 → 21:11:57
task_5b90101a-5958-44ce-95da-35369bb36268 agent=planning status=archived prNumber=undefined  20:44:38 → 21:11:50
task_d3044607-689f-4e9d-9a82-77ca7c162dcc agent=review   status=archived prNumber=1959       21:11:19 → 21:32:38
task_48cf38f9-6380-42a5-b1b5-006878a84ea6 agent=planning status=archived prNumber=undefined  20:44:38 → 20:56:27
task_4130eee8-d136-4b32-aeb9-6a50a8561aaa agent=review   status=archived prNumber=1953       20:55:31 → 21:14:21
```

In every case the review's `createdAt` precedes the planning task's `completedAt`, and the planning task has `prNumber=undefined` throughout its lifetime in Firestore.

### 2.3 Root cause #1 — `worker_unavailable` is treated as terminal

**File:** `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:512-526`

```ts
if (!dispatchResult.ok) {
  const dispatchError = dispatchResult.error;

  // Only at_capacity means workers are genuinely busy — task stays queued
  if (dispatchError.code === 'at_capacity') {
    logger.info({ taskId: task.id, error: dispatchError }, 'Workers still busy, task remains queued');
    return ok({ action: 'still_busy', taskId: task.id });
  }

  // Other dispatch failures (network_error, dispatch_failed, etc.) — fail the task
  logger.error({ taskId: task.id, error: dispatchError }, 'Drain dispatch failed with non-capacity error');
  const failUpdateResult = await codeTaskRepo.update(task.id, {
    status: 'failed',
    error: {
      code: dispatchError.code,
      message: `Drain dispatch failed: ${dispatchError.message}`,
    },
  });
  …
}
```

The dispatcher returns `worker_unavailable` whenever **all worker health probes fail** (`apps/code-agent/src/infra/services/taskDispatcherImpl.ts:201-209`). Conditions that produce that return: 5-second tunnel hiccup, transient HTTP 5xx, brief Cloud Run cold-start storm, container restart. Every one of those should keep the task queued.

The system already classifies `worker_unavailable` as retryable in `apps/code-agent/src/domain/utils/retryableErrors.ts:9-12`:

```ts
const RETRYABLE_ERROR_CODES = new Set(['worker_unavailable', 'network_error']);
```

…but `isRetryableErrorCode` is consumed only by `drainRetryQueue` (the webhook-trigger queue, separate code path). It is **not consulted by `drainTaskQueue`** — the drain path treats every non-`at_capacity` dispatch error as terminal.

### 2.4 Root cause #2 — concurrency guard misses planning↔review interleave

**File:** `apps/code-agent/src/infra/firestore/task-query-builder.ts:113-123`

```ts
export function dispatchedOrRunningForPR(collection, repository, prNumber) {
  return collection
    .where('repository', '==', repository)
    .where('prNumber', '==', prNumber)              // ← planning task: prNumber=undefined → never matches
    .where('status', 'in', DISPATCHED_OR_RUNNING_STATUSES)
    .limit(1);
}
```

Drain at `drainTaskQueue.ts:212-233` calls this and resets `queuedAt` on a hit. Planning never has `prNumber` written to its Firestore document — proven directly above — so the guard never fires for "active planning blocks new review on the same Linear issue."

A `linearIssueId`-scoped query already exists at `task-query-builder.ts:126-133`:

```ts
export function activeByLinearIssue(collection, linearIssueId) {
  return collection
    .where('linearIssueId', '==', linearIssueId)
    .where('status', 'in', ACTIVE_TASK_STATUSES);
}
```

`task-dedup.ts:178` uses `ACTIVE_TASK_STATUSES` for the single-task-per-issue check **at task creation time**. Drain-time enforcement is the missing complement: it is never wired into the dispatch path.

### 2.5 Plan-review oscillation is a consequence, not a third bug

The 7-9 task chains per issue are the compound effect of (1) and (2):

1. Planning attempt fails (TASK_RUNTIME_HARD_ERROR — fixed in PR #1966).
2. `triageFailedTask` retries automatically.
3. Each retry pushes new commits → GitHub `synchronize` webhook → review task enqueued.
4. Drain dispatches the review concurrently with planning (root cause #2).
5. Eventually capacity collapses → final task hits `worker_unavailable` and dies (root cause #1).

The lone INT-1486 chain (only 2 tasks, the second hitting `worker_unavailable` on its first auto-retry) confirms that without the loop pattern, root cause #1 alone is sufficient to lose a task.

---

## 3. Fix plan

### Fix A — `drainTaskQueue` keeps task queued for retryable dispatch errors

**Scope:** `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:509-534`

Change the post-dispatch error handler to consult `isRetryableErrorCode`. Retryable errors (currently `worker_unavailable`, `network_error`) follow the same path as `at_capacity` today: keep the task `queued`, reset `queuedAt` so the TTL clock restarts. Only truly permanent errors finalise as `failed`.

```ts
import { isRetryableErrorCode } from '../utils/retryableErrors.js';
…
if (dispatchError.code === 'at_capacity' || isRetryableErrorCode(dispatchError.code)) {
  // Reset queuedAt so the TTL clock starts from the moment workers become unavailable,
  // not from when the task first entered the queue. Mirrors PR-lock-blocked branch.
  await codeTaskRepo.update(task.id, { queuedAt: new Date() });
  logger.info(
    { taskId: task.id, error: dispatchError, retryable: true },
    'Dispatch retryable, task remains queued'
  );
  return ok({ action: 'still_busy', taskId: task.id });
}
```

**Why this is safe:**

* `INTEXURAOS_QUEUE_TTL_MINUTES` (`config.queue.ttlMinutes`) bounds how long a task can sit queued. The existing TTL branch (`drainTaskQueue.ts:247-275`) expires tasks past that window with `code: 'queue_timeout'` and a WhatsApp notification. Unbounded queuing is impossible by construction.
* `at_capacity` already follows the exact same path; we are widening the set of error codes that take it.
* `RETRYABLE_ERROR_CODES` is the single authoritative classifier. Adding new retryable codes flows through automatically.

**Evidence this fix helps:**

* 12 of 15 chains in §2.1 end with `worker_unavailable`. Replaying those 12 task IDs through the new branch produces `action: 'still_busy'` and the task remains queued — proven by the same `at_capacity` branch which is already correct and covered by `drainTaskQueue.test.ts`.
* The retry queue (`DispatchRetry`) for webhook-triggered events already implements this exact semantics for `worker_unavailable` — we are matching the queue side to behaviour the rest of the system already provides.

**Test plan:**

* New parameterised case in `apps/code-agent/src/__tests__/usecases/drainTaskQueue.test.ts`:
  ```ts
  it.each(['worker_unavailable', 'network_error'])(
    'keeps task queued and bumps queuedAt for retryable code %s',
    async (code) => { … }
  );
  ```
* Regression assertion: `dispatch_failed`, `invalid_response`, etc. still finalise as `failed`.
* 95% branch coverage on the modified function.

### Fix B — concurrency guard scoped to Linear issue (covers planning↔review interleave)

**Scope:**
- `apps/code-agent/src/domain/repositories/codeTaskRepository.ts` (new method)
- `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts` (wire to `activeByLinearIssue`)
- `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:212-233` (call new method after PR guard)

Add `hasOtherActiveForLinearIssue(taskId, linearIssueId)` to the repository contract. Implementation runs `activeByLinearIssue(linearIssueId)` and excludes the candidate's own document. Drain calls it after the PR-active check; if a sibling task is active on the same Linear issue, defer exactly like the PR-lock branch (skip + reset `queuedAt`).

```ts
// drainTaskQueue.ts (after PR-active guard)
if (candidate.linearIssueId !== undefined) {
  const issueActiveResult = await codeTaskRepo.hasOtherActiveForLinearIssue(
    candidate.id,
    candidate.linearIssueId
  );
  if (issueActiveResult.ok && issueActiveResult.value.hasActive) {
    logger.info(
      {
        taskId: candidate.id,
        linearIssueId: candidate.linearIssueId,
        activeTaskId: issueActiveResult.value.taskId,
      },
      'Skipping queued task — another task on the same Linear issue is active'
    );
    await codeTaskRepo.update(candidate.id, { queuedAt: new Date() });
    continue;
  }
}
```

**Why this is safe:**

* Round-robin candidate ordering (`drainTaskQueue.ts:188-190`) sorts by `createdAt`. The earliest task per issue wins — usually planning at 20:44:38, ~10 minutes before the first review.
* Tasks without `linearIssueId` (rare; direct `/tasks` API calls without a Linear backing) bypass the guard unchanged.
* `task-dedup.ts:178` already enforces single-task-per-issue **at creation time**; drain-time enforcement is the missing dual.

**Evidence this fix helps:**

For every (planning, review) pair in §2.2:

* At review's `createdAt`, planning was `running` (or `dispatched`) with matching `linearIssueId`.
* `activeByLinearIssue('INT-1529')` would return the running planning task at 20:54:17.
* New guard defers review dispatch and resets its `queuedAt`. Planning completes (or fails). Review dispatches on the next drain cycle.
* End state per issue: planning + at-most-one review, not 7-9 tasks.

**Test plan:**

* Unit test in `drainTaskQueue.test.ts`: enqueue review with `prNumber=X, linearIssueId=Y`; have `running` planning task with `linearIssueId=Y` and undefined `prNumber`. Assert today's PR guard misses, new Linear-issue guard fires.
* Replay test fixture (`drainTaskQueue-INT1560-replay.test.ts`): hand-encode the INT-1529 chain (planning + review + linearIssueId timeline) and assert the review's drain action is `still_busy` until the planning task completes.

### Fix C — orchestrator stamps `prNumber` on planning tasks (defence in depth, narrower)

**Scope:** orchestrator side. The orchestrator already correlates branches → task IDs for status callbacks; extend it to PATCH `prNumber` onto the task document via `/internal/code-tasks/:id/status` as soon as the planning agent's first push lands. May require adding `prNumber` to that endpoint's accepted body schema (`apps/code-agent/src/routes/code/updateTaskStatusRoute.ts`).

**Evidence this fix helps:**

* Once planning has `prNumber=1951`, the existing `dispatchedOrRunningForPR` guard catches active planning when a review for PR=1951 enqueues — without needing Fix B at all.
* This is **redundant with Fix B but narrower** (PR-scope vs Linear-issue-scope). Fix B already covers every case Fix C covers and more.
* Worth doing only if PR-level analytics elsewhere (UI, status dashboards) need reliable `prNumber` on planning tasks.

**Open decision:** ship A+B and skip C? Or A+B+C? Default recommendation: A+B for now, file C as a separate `tech-debt` issue tracked under "make planning's prNumber observable in Firestore."

### Verification approach (replay test)

`apps/code-agent/src/__tests__/usecases/drainTaskQueue-INT1560-replay.test.ts`:

1. Encode the INT-1529 timeline as a sequence of `enqueue → dispatch-attempt → dispatch-result` events, with the same Firestore states observed in production (planning at 20:44:38 with `prNumber=undefined`, review at 20:54:17 with `prNumber=1951`, etc.).
2. Drive the events through `drainTaskQueue` with `FakeCodeTaskRepository` and `FakeTaskDispatcherService`.
3. Assertions:
   * **Fix A:** the simulated final `worker_unavailable` returns `action: 'still_busy'`. Task status remains `queued`.
   * **Fix B:** every review enqueued while a planning is active returns `action: 'still_busy'` from drain until the planning task completes.
   * **Compound:** the chain of tasks dispatched for the issue is `≤2` (one planning, optionally one review after planning completes), not 7-9.

Fixtures are written from the Firestore records queried during this investigation — real shapes, real timings.

---

## 4. Out of scope (separate issues)

* **P1 — per-user concurrency cap on the dispatcher side** (from INT-1560 plan). Fix A makes uncapped concurrency far less harmful but doesn't eliminate the underlying queue-flooding pattern. Independent improvement.
* **P3 — health-probe quorum.** Today's 5s single-probe-per-worker failure is sensitive; 2-of-3 with jittered backoff would reduce the rate of `worker_unavailable` returns. Independent improvement.
* **P13 — review-rounds cap.** With Fix B in place, plan↔review *concurrent* execution is impossible, but consecutive sequential loops (planning fails → retry → review → fails → retry → …) are still possible. A `maxReviewRounds=2` cap is a separate improvement worth its own issue.

---

## 5. Endpoint changes

* **Modified:** `apps/code-agent/src/domain/usecases/drainTaskQueue.ts` (Fix A + Fix B integration).
* **Created:** none.
* **Removed:** none.
* **Unchanged:** all HTTP routes; no new endpoints, no schema changes (Fix C, if pursued, would extend the body schema of the existing `PATCH /internal/code-tasks/:id/status`).

---

## 6. Done criteria

- [ ] Fix A: `drainTaskQueue` consults `isRetryableErrorCode` for the still-queued path; truly permanent codes still fail.
- [ ] Fix B: drain calls `hasOtherActiveForLinearIssue` (new repo method) and defers when active.
- [ ] Replay test asserts the INT-1529 chain ends with ≤2 tasks (not 9) under the new logic.
- [ ] All existing `drainTaskQueue.test.ts` cases still pass.
- [ ] `pnpm run verify:workspace:tracked code-agent` and `pnpm run ci:tracked` both green.
- [ ] PR title includes `INT-XXXX`; user creates the issue on push.
- [ ] Decision recorded: ship Fix C (defence-in-depth) now or defer.
