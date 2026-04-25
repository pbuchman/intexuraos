# Dispatch + Concurrency Failures — Investigation, Evidence, and Fix Plan

> **Status:** investigation + plan only. No code changes shipped here.
> **Sibling investigation:** `docs/plans/INT-1560-failed-subtasks-investigation.md` (the parser-side failure mode, which is fixed in PR #1966 — `fix(orchestrator): NDJSON-aware fallback in locateFinalBlock`).
> **Linear issue:** _user creates on push._
> **External validation:** independently audited by Codex (`gpt-5.5`, reasoning effort `xhigh`) on 2026-04-25. The audit confirmed 5 of 8 numbered claims, rejected 2, marked 2 as partial, and surfaced 6 additional issues. **§7 of this document records the rejections + the resulting plan corrections** — read it before implementing.

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

Drain at `drainTaskQueue.ts:212-233` calls this and resets `queuedAt` on a hit. Planning's `prNumber` field is **stamped only after a successful completion via `handleTaskCompletion`** — see `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts:1050-1095` and `:1227-1267`, which extract `prNumber` from `result.prUrl`. While the planning task is **`running`** the field is unset, **and failed planning runs (e.g. TASK_RUNTIME_HARD_ERROR before the parser fix) never reach the success branch that writes `prNumber`** — confirmed by §2.2 where every archived planning task has `prNumber=undefined`. So during the exact window when a `synchronize` webhook is firing reviews against the in-flight planning's PR, the PR-active guard cannot match the planning task.

(The initial draft of this section claimed planning tasks "NEVER" get `prNumber` stamped, which is too strong — Codex audit §7 rejection #6 cites the success-path writers. The practical implication for the bug is unchanged.)

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
  // DO NOT reset queuedAt here. The existing `at_capacity` branch leaves
  // queuedAt untouched, and so must we — otherwise TTL never bounds the
  // task's lifetime in the queue (Codex audit, §7 rejection #9). The
  // existing TTL branch at drainTaskQueue.ts:247-275 fires `queue_timeout`
  // once `now - queuedAt > config.queue.ttlMinutes` regardless of how
  // many times we hit this branch.
  logger.info(
    { taskId: task.id, error: dispatchError, retryable: true },
    'Dispatch retryable, task remains queued'
  );
  return ok({ action: 'still_busy', taskId: task.id });
}
```

**Why this is safe:**

* `INTEXURAOS_QUEUE_TTL_MINUTES` (`config.queue.ttlMinutes`) bounds how long a task can sit queued — **only because we do NOT reset `queuedAt`**. The existing TTL branch (`drainTaskQueue.ts:247-275`) expires tasks past that window with `code: 'queue_timeout'` and a WhatsApp notification. (Initial draft of this plan proposed resetting `queuedAt`; Codex's audit caught that it would defeat the TTL — see §7. The corrected fix above does NOT reset.)
* `at_capacity` already follows the exact same path (no `queuedAt` reset); we are widening the set of error codes that take it.
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
- `apps/code-agent/src/domain/repositories/codeTaskRepository.ts` (new method, OR reuse the existing `hasActiveTaskForLinearIssue` — see below)
- `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:132-139` (already wires `activeByLinearIssue` to a repo method named `hasActiveTaskForLinearIssue`; Codex audit confirmed)
- `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:212-233` (call after PR guard)

**Narrowed semantics (post-Codex audit, see §7 partial #10 + Linear-deadlock additional issue):** the new check must be **review-side only and scoped to dispatched-or-running siblings, not all queued ones.**

* **Trigger:** only when the candidate is a `review` task. Planning tasks already pass through (no need to gate them — they're the source of the lock, not the victim of it).
* **Filter:** use `DISPATCHED_OR_RUNNING_STATUSES` (excluding `queued`), not `ACTIVE_TASK_STATUSES`. This avoids the deadlock where two queued reviews on the same Linear issue see each other as "active" and both defer forever.
* **Excludes self:** repo method takes `(candidateId, linearIssueId)` and filters out the candidate's own document.
* **No `queuedAt` reset:** matches Fix A's no-reset rule so TTL still bounds the queue lifetime.

```ts
// drainTaskQueue.ts (after PR-active guard)
if (candidate.agentType === 'review' && candidate.linearIssueId !== undefined) {
  const blocker = await codeTaskRepo.hasOtherDispatchedOrRunningForLinearIssue(
    candidate.id,
    candidate.linearIssueId,
  );
  if (blocker.ok && blocker.value.hasActive) {
    logger.info(
      {
        taskId: candidate.id,
        linearIssueId: candidate.linearIssueId,
        activeTaskId: blocker.value.taskId,
      },
      'Deferring review — another task on the same Linear issue is dispatched/running',
    );
    // Intentionally NO queuedAt reset (TTL must still apply).
    continue;
  }
}
```

**Why this is safe:**

* Round-robin candidate ordering (`drainTaskQueue.ts:188-190`) sorts by `createdAt`, so the earliest task per Linear issue still wins.
* Tasks without `linearIssueId` (rare; direct `/tasks` API calls without a Linear backing) bypass the guard unchanged.
* `task-dedup.ts:170-205` already enforces single-task-per-issue at creation time — but **explicitly excludes review tasks** (Codex audit additional issue #5), which is why drain-time enforcement is needed exactly for reviews and not redundant.
* Review-only scope means: multiple reviews against **different PRs** that happen to share a Linear issue (e.g. a refactor that opens 3 PRs each with their own review) are no longer all serialized — only when an actual planning/execution sibling is running, the review defers. Two-PR-per-issue users are not penalized.
* Cancel-duplicate-review block at `drainTaskQueue.ts:115-167` runs first and reduces the candidate set before our guard sees it, so churn from multiple `synchronize` webhooks creating duplicate reviews on the same PR doesn't pile up.

**Why the deadlock concern is solved:**

* `DISPATCHED_OR_RUNNING_STATUSES = ['dispatched', 'running']` (per `task-constants.ts:11-15`). Two `queued` reviews for the same Linear issue do NOT see each other through this guard. Only a true running sibling (planning/execution) blocks.
* Round-robin still picks the oldest queued task; if no sibling is running, the new guard is a no-op and dispatch proceeds.

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

### Fix D — auto-retry chain TTL preservation (INT-1529 chains were 9 tasks long because TTL never bound the loop)

**Scope:** `apps/code-agent/src/domain/usecases/autoRetryTask.ts:112-152` and `apps/code-agent/src/infra/services/taskEnqueueServiceImpl.ts:75-83`.

The Codex audit caught that every auto-retry creates a brand-new task whose `enqueue()` stamps a fresh `queuedAt` (taskEnqueueServiceImpl.ts:75-83). Combined with `triageFailedTask → autoRetryTask` (triageFailedTask.ts:55-90 → autoRetryTask.ts:112-152) firing on every failed planning attempt, the retry chain has no upper bound: each link gets its own TTL window and the chain can live indefinitely. The 9-task INT-1529 chain in §2.2 is the direct consequence — Fix B serializes plan↔review *within* a chain link, but does nothing to bound the chain itself.

**Two-part fix:**

1. **Carry forward the original `queuedAt`.** When `autoRetryTask` creates the retry task, copy `failedTask.queuedAt` (or `failedTask.createdAt` if `queuedAt` is unset) onto the new task explicitly. `taskEnqueueService.enqueue()` already stamps `queuedAt: new Date()` unconditionally; either (a) make `enqueue` accept a caller-provided `queuedAt` override, or (b) have `autoRetryTask` write the inherited value via `codeTaskRepo.update` immediately after enqueue. Option (a) is cleaner.

2. **Bound the retry attempt count per Linear-issue chain.** Store `autoRetryAttempt` (already present on the task model — see the `autoRetryAttempt: 3` field on the captured `task_11f5bc37` data). Cap at `config.autoRetry.maxAttempts` (default 3). Beyond the cap, `triageFailedTask` returns `permanent_failure` instead of attempting another retry.

**Why this is in scope, not "out of scope":**

* Fix A keeps tasks queued during transient outages.
* Fix B prevents reviews from running concurrently with planning.
* But the user's original report — "the loop of planning review that we are failing consecutively" — is the chain length. Without Fix D, even with A+B in place, a persistently failing planning task spawns indefinite retries. The 9-task chain stays 9 tasks long.
* The audit-caught issue is a **load-bearing piece** of the fix the user explicitly asked for, not a tangential concern.

**Evidence this fix helps:**

* The captured INT-1529 chain has 9 tasks, with `retriedFrom` pointing back to the previous failed planning each time. The 5th retry is the one that hit `worker_unavailable` and died — by which point the issue had been re-attempted 5 times in 90 minutes.
* With Fix D + `maxAttempts=3`, the chain caps at 3 planning attempts. With Fix A keeping the 3rd attempt queued through transient outages, total task count per issue would be ≤4 (one planning, one terminal-fail planning after retries exhausted, optionally one review).
* The original `queuedAt` carry-forward means TTL applies across the entire chain: 30 minutes from the *first* attempt, not 30 minutes per link.

**Test plan:**

* Unit test in `autoRetryTask.test.ts`: failed task has `queuedAt = T0`; retry task is enqueued at `T1`; assert the retry task's `queuedAt == T0` (carried forward).
* Unit test in `triageFailedTask.test.ts`: failedTask has `autoRetryAttempt: 3` and `maxAttempts=3`; assert verdict `permanent_failure` and no new task created.
* Replay test extends INT-1529 fixture: assert chain caps at 3 planning tasks total, not 5+.

### Fix E — atomic dispatch claim (single-instance race today, multi-instance race tomorrow)

**Scope:** `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:53-98` (the `isDraining` process-local flag) and `:479-551` (the dispatch-then-update sequence).

The Codex audit pointed out that `isDraining` is a per-process boolean. Today on home-dev there is one orchestrator + one code-agent instance, so the race is latent. In Cloud Run with autoscaling (production), two replicas can both fetch the same queued task and both dispatch it before either updates Firestore status to `dispatched`. The current code is `dispatch → update status`, not `claim status atomically → dispatch`.

**Fix:** replace the dispatch-then-update sequence with a Firestore transaction that claims the candidate by atomically transitioning its status from `queued` to `dispatched` BEFORE the network call. If the transition fails (another instance got there first), skip the candidate and pick the next.

```ts
// Replace drainTaskQueue.ts:479-507 with:
const claimResult = await codeTaskRepo.claimForDispatch(task.id);  // Firestore txn: queued→dispatched
if (!claimResult.ok || claimResult.value.alreadyClaimed) {
  logger.info({ taskId: task.id }, 'Skipped — claimed by another instance');
  continue;
}
// Now safe to call the network dispatcher; only one replica reaches here.
const dispatchResult = await taskDispatcher.dispatch({ … });
if (!dispatchResult.ok) {
  // ... existing error handling, including Fix A's still-queued path
  // But if we already claimed: we need to ROLL BACK to queued before returning still_busy.
  if (dispatchError.code === 'at_capacity' || isRetryableErrorCode(dispatchError.code)) {
    await codeTaskRepo.update(task.id, { status: 'queued' });   // release the claim
    return ok({ action: 'still_busy', taskId: task.id });
  }
  // permanent codes already finalize the task as 'failed' — no rollback needed.
}
```

**Why this is in scope:**

* The user's home-dev environment is single-instance, so the bug is dormant. But the production target (Cloud Run) is autoscaling. Shipping Fix A/B without Fix E means: production traffic could double-dispatch a task and burn a worker slot uselessly, exacerbating the very capacity exhaustion the plan is trying to fix.
* The fix is small (one new repo method, one swapped call site) and removes an entire class of duplication.

**Evidence this fix helps:**

* The transaction semantics of Firestore (`runTransaction`) guarantee linearizability on the document. Two replicas calling `claimForDispatch(taskId)` concurrently produce exactly one success and one `alreadyClaimed`.
* Cloud Run's auto-scaling target for `code-agent` (per `terraform/environments/dev/main.tf` configuration) allows up to N replicas; today's flag-based guard does not extend across them.

**Test plan:**

* Repository test in `firestoreCodeTaskRepository.test.ts`: simulate two concurrent `claimForDispatch` calls (Promise.all on the txn); assert exactly one returns `claimed: true` and the other returns `alreadyClaimed: true`.
* Drain integration test: two `drainTaskQueue` runs in parallel against the same `FakeCodeTaskRepository`; assert dispatcher is called exactly once.

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

## 7. External audit (Codex `gpt-5.5` xhigh, 2026-04-25)

The original draft was independently re-investigated by Codex against the wider codebase. Findings, with the resulting corrections folded into the relevant sections above:

### Confirmed (5)

* **Claim 1** — `drainTaskQueue.ts:509-533` finalises every non-`at_capacity` dispatch error as `failed`.
* **Claim 2** — `taskDispatcherImpl.ts:176-193` and `:201-209` return `worker_unavailable` when no healthy probes remain.
* **Claim 3** — `retryableErrors.ts:8-12` lists exactly `worker_unavailable` and `network_error`.
* **Claim 4** — `isRetryableErrorCode` is consumed by `drainRetryQueue.ts:23,355,454` and `webhookDispatch.ts:223-240`, **not** by `drainTaskQueue`.
* **Claim 5** — `dispatchedOrRunningForPR` filters `where('prNumber', '==', prNumber)` (`task-query-builder.ts:112-123`).
* **Claim 7** — `activeByLinearIssue` exists at `task-query-builder.ts:125-133`, repo wraps it as `hasActiveTaskForLinearIssue` (`firestoreCodeTaskRepository.ts:132-139`), but `drainTaskQueue` never calls it.

### Rejected (2) — corrections folded back into §2 / §3

* **Claim 6 — REJECTED.** Planning tasks **can** get `prNumber` stamped via the success-path completion handlers at `handleTaskCompletion.ts:1050-1095` and `:1227-1267` (extracts from `result.prUrl`). Auto-retry copies `prNumber` from the failed task at `autoRetryTask.ts:112-130`. The original draft's "NEVER stamped" wording is too strong. **Corrected wording in §2.4:** planning tasks have `prNumber` stamped only on **successful** completion; while `running` and across **failed** completions the field stays unset. The §2.2 Firestore evidence (every archived planning task has `prNumber=undefined`) is consistent with this — those tasks all failed before reaching the success branch.
* **Claim 9 — REJECTED.** The original draft's Fix A reset `queuedAt` on every retryable dispatch error. Codex pointed out: (a) this defeats TTL because TTL is measured from `queuedAt`; (b) the existing `at_capacity` branch at `drainTaskQueue.ts:512-515` does **not** reset, contradicting the draft's "same path" claim. **Correction folded into §3 Fix A:** removed the `queuedAt` reset; behaviour now exactly matches `at_capacity`. TTL bounds the queue lifetime as advertised.

### Partial (2)

* **Claim 8 — PARTIAL.** Mechanism is sound but `TASK_RUNTIME_HARD_ERROR` retry only fires when the message contains `137` OR via the `remediation.action === 'retry'` hint that the orchestrator attaches (`classifyFailure.ts:55-77`). The orchestrator **does** attach that hint at `task-dispatcher.ts:1710-1714`, so the loop still occurs — but the trigger is the remediation hint, not the error code unconditionally. Note: the "fixed in PR #1966" claim is not independently provable from current source; the merge sits in git history and the NDJSON-aware extractor exists in tree.
* **Claim 10 — PARTIAL.** Fan-out is unaffected (children carry their own `linearIssueId`), but the original "cannot starve legitimate parallel work" was too strong: a broad Linear-issue guard would block multiple reviews for **different PRs** that happen to share one Linear issue. **Correction folded into §3 Fix B:** narrowed the guard to (i) review-side only, (ii) `DISPATCHED_OR_RUNNING_STATUSES` (excluding `queued`), so that two queued reviews on the same Linear issue cannot deadlock and reviews for distinct PRs aren't serialized.

### Additional issues Codex surfaced

| #   | Issue                                                                                                                                      | Citation                                                                                                             | Disposition                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `isDraining` is process-local; multi-instance code-agents can dispatch the same task twice between candidate-fetch and status-update.      | `drainTaskQueue.ts:53-98,479-507,536-551`                                                                            | **Owned. Folded into §3 Fix E (atomic dispatch claim).** Latent on single-instance home-dev; live on multi-replica production code-agent. Removing the race is part of this PR's scope.                                                                                                                                              |
| 2   | Linear guard could deadlock on `ACTIVE_TASK_STATUSES` (which includes `queued`).                                                           | `task-constants.ts:11-15`, `task-query-builder.ts:125-133`                                                           | **Addressed in §3 Fix B narrowing.** New repo method uses `DISPATCHED_OR_RUNNING_STATUSES`.                                                                                                                                                                                                                                          |
| 3   | Synchronize webhooks keep creating fresh queued reviews; the new guard would defer the survivor.                                           | `drainTaskQueue.ts:115-166`, `createReviewTask.ts:296-363`                                                           | **Acceptable.** Cancel-duplicate-review at `drainTaskQueue.ts:115-167` runs first and collapses duplicates per PR before the new guard sees them. With the no-`queuedAt`-reset rule (§3 Fix A correction), TTL eventually expires the survivor if planning never completes.                                                          |
| 4   | Auto-retry creates a fresh task with a new `queuedAt`, restarting TTL. Retry chains can live indefinitely if the failure is persistent.    | `autoRetryTask.ts:112-152`, `taskEnqueueServiceImpl.ts:75-83`                                                        | **Owned. Folded into §3 Fix D (auto-retry chain TTL preservation + per-chain attempt cap).** Without this, even with Fix A+B in place, a persistently failing planning task spawns indefinite retries — the 9-task INT-1529 chain stays 9 tasks long. Directly load-bearing for the user-reported "loop of planning review" symptom. |
| 5   | Existing dedup at `task-dedup.ts:170-205` excludes review tasks, so Fix B is **not** redundant.                                            | same                                                                                                                 | **Confirmed; clarified in §3 Fix B "Why this is safe."**                                                                                                                                                                                                                                                                             |
| 6   | Worker-side dispatch endpoint emits `at_capacity` / `docker_unavailable` / `auth_unavailable` / `SETUP_FAILED` — not `worker_unavailable`. | `workers/orchestrator/src/services/task-dispatcher.ts:249-257,464-491`, `workers/orchestrator/src/routes.ts:182-205` | **Confirmed; consistent with the plan.** `worker_unavailable` originates only on the code-agent dispatcher side after probe failures, not from the orchestrator HTTP API.                                                                                                                                                            |

### Net effect on the plan

* Fix A is **simpler and more correct** post-audit: drop the `queuedAt` reset; rely on the existing TTL.
* Fix B is **narrower and safer** post-audit: review-only, dispatched-or-running siblings only, no reset.
* Fix C remains optional defence-in-depth; nothing in the audit changes its risk profile.
* Fix D (auto-retry TTL + attempt cap) and Fix E (atomic dispatch claim) added to the PR scope. Both were caught by the audit; both are load-bearing for the user-reported symptoms.

---

## 8. Done criteria

- [ ] Fix A: `drainTaskQueue` consults `isRetryableErrorCode` for the still-queued path; truly permanent codes still fail. **No `queuedAt` reset** in this branch (matches `at_capacity`).
- [ ] Fix B: drain calls a new `hasOtherDispatchedOrRunningForLinearIssue` repo method, **only on `review` candidates**, with **DISPATCHED_OR_RUNNING_STATUSES** filter; defers when a non-self sibling is running. No `queuedAt` reset.
- [ ] Fix D: `autoRetryTask` carries forward `queuedAt` from the failed task to the retry; `triageFailedTask` honors `config.autoRetry.maxAttempts` and returns `permanent_failure` once the cap is hit so retry chains terminate.
- [ ] Fix E: `drainTaskQueue` claims the candidate via a Firestore transaction (`claimForDispatch`) before calling the dispatcher; rolls back to `queued` on retryable errors so the next drain sees the claim released.
- [ ] Replay test asserts the INT-1529 chain ends with ≤2 tasks (not 9) under the new logic.
- [ ] All existing `drainTaskQueue.test.ts` cases still pass.
- [ ] New tests confirm: (a) `worker_unavailable`/`network_error` keeps task queued without resetting `queuedAt`; (b) review with running planning sibling defers; (c) two queued reviews on same Linear issue do NOT deadlock; (d) review for a different PR is unaffected when planning runs on a sibling PR's Linear issue; (e) auto-retry chain inherits original `queuedAt` and TTL applies across the chain; (f) two concurrent `claimForDispatch` calls produce exactly one success and one already-claimed; (g) retry attempt cap returns `permanent_failure` once `maxAttempts` is reached.
- [ ] `pnpm run verify:workspace:tracked code-agent` and `pnpm run ci:tracked` both green.
- [ ] PR title includes `INT-XXXX`; user creates the issue on push.
- [ ] Decision recorded: ship Fix C (defence-in-depth) now or defer.
