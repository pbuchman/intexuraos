# INT-1560 — Failed-subtask investigation for INT-1472 / INT-1473

> **For agentic workers:** This document is an **investigation report**, not an implementation
> plan. It groups every observed failure mode into named clusters with root cause, fix, and
> prevention. Create one Linear issue per cluster (out of scope for this PR — the user controls
> dispatch).

**Goal:** Explain *why* the subtasks of INT-1472 (security audit) and INT-1473 (refactoring
audit) ended in `failed` / `Canceled` / `Todo (never dispatched)`, grouped by root cause, with
concrete fixes and preventive measures.

**Scope:** 55 children of INT-1472 + 10 children of INT-1473 = 65 subtasks. Evidence comes from
the Firestore `code_tasks` collection, the Linear issue states, and Cloud Logging in
`intexuraos-dev-pbuchman` between `2026-04-24T20:44Z` and `2026-04-24T22:30Z`.

**Tech stack involved:** `apps/code-agent` (dispatcher), `workers/orchestrator` (task-dispatcher
+ completion-verifier), `docker/code-worker` (Docker VM that hosts the agent), Firestore
`code_tasks`.

---

## 1. Outcome inventory

### 1.1 INT-1472 — "Identify and document security vulnerabilities"

55 children created (INT-1474 … INT-1528). Final disposition:

| Bucket                                            | Count | Children                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In Review** (planning produced PR)              | 4     | INT-1483, INT-1520, INT-1524, INT-1525                                                                                                                                                                                                                |
| **Todo, dispatched once, ended in failed**        | 1     | INT-1486                                                                                                                                                                                                                                              |
| **Canceled in Linear, never dispatched**          | 18    | INT-1480, INT-1503, INT-1504, INT-1506, INT-1507, INT-1510, INT-1511, INT-1512, INT-1513, INT-1515, INT-1516, INT-1518, INT-1521, INT-1522, INT-1523, INT-1526, INT-1527, INT-1528                                                                    |
| **Todo, never dispatched**                        | 32    | All other INT-1474 … INT-1519 not listed above                                                                                                                                                                                                        |

### 1.2 INT-1473 — "Identify and document system refactoring areas"

10 children created (INT-1529 … INT-1538). All 10 produced a planning PR and ended with a
**final code-task in `status=failed`** after multiple retries. Each child has 7-9 code tasks
(planning ↔ review ping-pong with `archived` predecessors) culminating in one terminal failed
task.

### 1.3 Failed code-task population

After joining `code_tasks` to the children:

| Subtask    | # tasks | Final status | Final error code                |
| ---------- | ------- | ------------ | ------------------------------- |
| INT-1483   | 3       | failed       | `worker_unavailable`            |
| INT-1486   | 2       | failed       | `worker_unavailable`            |
| INT-1520   | 3       | failed       | `worker_unavailable`            |
| INT-1524   | 5       | failed       | `TASK_RUNTIME_HARD_ERROR`       |
| INT-1525   | 5       | failed       | `worker_unavailable`            |
| INT-1529   | 9       | failed       | `worker_unavailable`            |
| INT-1530   | 7       | failed       | `TASK_RUNTIME_HARD_ERROR`       |
| INT-1531   | 8       | failed       | `worker_unavailable`            |
| INT-1532   | 8       | failed       | `worker_unavailable`            |
| INT-1533   | 9       | failed       | `worker_unavailable`            |
| INT-1534   | 8       | failed       | `worker_unavailable`            |
| INT-1535   | 7       | failed       | `worker_unavailable`            |
| INT-1536   | 8       | failed       | `worker_unavailable`            |
| INT-1537   | 8       | failed       | `worker_unavailable`            |
| INT-1538   | 8       | failed       | `worker_unavailable`            |

Aggregate: **15 dispatched subtasks, 95 code-tasks, 18+ terminal failures, 5 distinct
TASK_RUNTIME_HARD_ERROR planning attempts caught mid-stream.**

---

## 2. Failure groups (by type of problem)

The 65 subtasks bucket cleanly into **four** failure groups. Groups are listed in descending
order of frequency.

### Group A — Worker capacity exhaustion / health-probe failure (`worker_unavailable`)

**Symptom:** dispatcher returns
`{"code":"worker_unavailable","message":"Drain dispatch failed: All worker health probes failed"}`,
the orchestrator marks the task `failed`, and Linear is left with the planning PR open but no
follow-up.

**Source code path:** `apps/code-agent/src/infra/services/taskDispatcherImpl.ts:201-209` returns
`worker_unavailable` when `workersWithCapacity.length === 0`. The filter at line 186 only
admits workers whose `_tag === 'healthy'`; under tunnel/timeout/HTTP-5xx errors from
`workers/orchestrator`'s `/health` route the entire pool collapses.

**Affected tasks:**

```
INT-1483 task_5cbcf4c5  review/glm   pr=1964  2026-04-24T22:04:17
INT-1486 task_7c7c79d0  planning/opus pr=-     2026-04-24T22:00:37
INT-1520 task_b716632d  review/glm   pr=1963  2026-04-24T21:59:39
INT-1520 task_031811c4  planning/opus pr=-     2026-04-24T21:59:56
INT-1525 task_d7f1dbfd  review/glm   pr=1961  2026-04-24T22:24:47
INT-1525 task_a538bfbe  planning/opus pr=-     2026-04-24T22:24:49
INT-1529 task_437cda4b  planning/opus pr=1951  2026-04-24T22:13:25  retriedFrom=task_bda09ecc
INT-1531 task_7bfdb433  review/glm   pr=1957  2026-04-24T22:19:59
INT-1532 task_b582bd75  planning/opus pr=1953  2026-04-24T22:13:58
INT-1533 task_c55d9e90  planning/opus pr=1952  2026-04-24T22:11:19
INT-1534 task_f9960aa3  review/glm   pr=1954  2026-04-24T22:15:26
INT-1535 task_c352f88e  review/glm   pr=-     2026-04-24T22:02:13
INT-1536 task_d150d7d6  review/glm   pr=1955  2026-04-24T22:19:03
INT-1537 task_734df64b  review/glm   pr=1958  2026-04-24T22:23:30
INT-1538 task_bd363634  planning/opus pr=1956  2026-04-24T22:12:06
```

**Cloud-Logging evidence:** `intexuraos-code-agent` emits
`"All worker health probes failed, no workers available for dispatch"` repeatedly between
22:28-22:29Z. Earlier at 22:27:10Z the same code-agent saw `"Worker is healthy"`. So the worker
flipped from healthy → all-probes-fail in ~70s.

**Root cause:** the user dispatched ~10 INT-1473 children **simultaneously at 20:44:38Z**, then
each child cycled through planning ↔ review repeatedly, peaking around 21:30-22:30Z. Combined
with the 5 INT-1472 dispatches starting 21:32Z, ≥15 concurrent code-tasks landed on a single
code-worker VM with finite slots (and a single Cloudflare tunnel). The orchestrator's `/health`
endpoint went into HTTP-5xx / timeout territory under load; the dispatcher correctly translated
that to `worker_unavailable`.

Three contributing weaknesses turned a temporary saturation into a terminal failure for every
in-flight task:

1. **No per-user concurrency limit before dispatch.** `code-agent` accepts unlimited concurrent
   tasks and tries every one against the same pool. Once probes start failing, *all* in-flight
   tasks fail in lock-step.
2. **Probe timeout is 5 s, dispatcher gives up after one probe round.**
   `workerHealthProbe.ts:15` sets `PROBE_TIMEOUT_MS = 5000` and there is no retry/backoff before
   `worker_unavailable` is returned.
3. **No queue-and-hold path for `worker_unavailable`.** The dispatcher returns immediately;
   nothing puts the task back in the retry queue when the cause is "all workers temporarily
   unhealthy" — the task is finalized as `failed`.

**How to fix the 15 affected subtasks:**

* Re-dispatch each subtask serially (`maxConcurrent = 2`) once the worker pool is healthy.
  Linear's "Retry" action on each `In Review` issue is sufficient — the existing PRs
  (e.g., 1951, 1953, 1956) can be reused as the planning baseline.
* For the canceled INT-1480/INT-1503/etc. set in Group C: re-create code tasks only after
  capacity controls are in place (see prevention).

**How to prevent recurrence:**

* **P1.** Add a per-user concurrency cap in `apps/code-agent` (config: `MAX_CONCURRENT_TASKS`,
  default 4). When exceeded, queue in `code_tasks` with `status=queued, queueReason=capacity`
  rather than dispatching. Drain via the existing `/internal/drain-queue` cron.
* **P2.** In `taskDispatcherImpl.ts`, change the response to `worker_unavailable` to **enqueue**
  the task instead of failing it (use the same retry queue that already handles
  `worker_unavailable` in `RETRYABLE_ERROR_CODES`). The current code path returns `failed`
  before reaching that retry layer.
* **P3.** Promote health-probe to a 2-of-3 quorum: probe each worker up to three times with
  jittered 1 s backoff before declaring it unreachable. Today a single 5 s timeout fails the
  probe.
* **P4.** Add a Cloud-Logging-based alert (`severity="WARNING" AND
  jsonPayload.msg=~"All worker health probes failed"`) that fires after 3 hits in 10 min. Today
  this signal is silent.
* **P5.** Provision a second `code-worker` VM (or multi-slot) so a single VM saturation does not
  drop the entire pool to zero healthy workers.

---

### Group B — Missing `*_AGENT_FINAL` block in transcript (`TASK_RUNTIME_HARD_ERROR`)

**Symptom:** `code_tasks.error.message = "No PLANNING_AGENT_FINAL: block in transcript"`,
`code_tasks.error.code = "TASK_RUNTIME_HARD_ERROR"`, the task is finalized as `failed`. The
agent did real work — produced commits, opened a PR — but its terminal turn omitted the
required completion block. The completion verifier in `workers/orchestrator/src/services/
task-dispatcher.ts:1690` short-circuits a `hard-error` verdict to terminal failure.

**Affected planning attempts:**

```
INT-1524 task_11f5bc37  planning/opus  2026-04-24T22:56:32
INT-1530 task_0bd1816f  planning/opus  2026-04-24T21:48:03
INT-1531 task_e52b2c93  planning/opus  2026-04-24T21:44:52
INT-1534 task_fe56588c  planning/opus  2026-04-24T21:38:43
INT-1535 task_cae30ee2  planning/opus  2026-04-24T21:56:00
INT-1536 task_f82effc9  planning/opus  2026-04-24T21:41:15
INT-1537 task_c6f6d0de  planning/opus  2026-04-24T21:50:56
```

**Root cause:** the planning system prompt declares `PLANNING_AGENT_FINAL:` as the final
machine-validated block. Two contributing factors:

1. **Prompt-contract drift.** When INT-1472/1473 ran, the live planning prompt at
   `workers/orchestrator/src/services/prompts/planning-prompt.ts` requires every memory ID to be
   accounted for, every numbered field to be present, and the block to be the *last* thing
   emitted. Long-running planning sessions that hit context-pressure or model-side truncation
   end the conversation with a summary in plain text, not the strict block. The deterministic
   parser then declares `missingFinalBlock` → `TASK_RUNTIME_HARD_ERROR`.
2. **Concurrent failure-mode confusion.** Several of these `TASK_RUNTIME_HARD_ERROR` rows happen
   *during* the Group A storm. When the worker recycles mid-run (kill -9 the orchestrator
   process under VM pressure), the transcript is truncated and the final block is lost. Today
   we cannot distinguish "agent forgot the block" from "process was killed before block was
   written" — both surface as the same hard-error.

**How to fix the 7 affected planning attempts:**

* Re-run planning on each (Linear retry on the parent issue). The PR branches already exist;
  only the planning summary needs re-emitting.

**How to prevent recurrence:**

* **P6.** In `workers/orchestrator/src/services/task-dispatcher.ts`, distinguish *truncation*
  from *agent-forgot*: if the transcript ends mid-tool-call or mid-line (no trailing newline,
  cut inside JSON), classify as `transcript_truncated` (retryable) instead of
  `TASK_RUNTIME_HARD_ERROR` (terminal). This is in scope of the existing
  `docs/superpowers/plans/2026-04-24-deterministic-agent-final-parser.md` plan but is not yet
  shipped.
* **P7.** Have the planning system prompt also accept a JSON-encoded sentinel
  `<<<PLANNING_AGENT_FINAL_JSON>>> { ... }` so the agent has two parallel paths to compliance.
  Today there is exactly one acceptable shape.
* **P8.** Add an inline self-check: before the agent ends its last turn, verify it has emitted
  the block via a tool call to a `verifyAgentFinal` tool. If missing, prompt one more turn to
  emit it.
* **P9.** Surface this failure mode in the `code-task-alerts` dashboard so the user can re-trigger
  immediately rather than discovering it hours later.

---

### Group C — Linear-level cancellation without dispatch

**Symptom:** 18 INT-1472 children moved to `Canceled` at the Linear level between
`2026-04-24T21:29:54Z` and `2026-04-24T21:36:23Z`. **None of them ever became a `code_tasks`
document** — they were never dispatched.

**Affected:** INT-1480, INT-1503, INT-1504, INT-1506, INT-1507, INT-1510, INT-1511, INT-1512,
INT-1513, INT-1515, INT-1516, INT-1518, INT-1521, INT-1522, INT-1523, INT-1526, INT-1527,
INT-1528.

**Root cause:** Linear comments are empty for all 18; `canceledAt` and `archivedAt` cluster
into a single 7-minute window. This pattern is consistent with **manual triage** by the user to
halt cascade after observing Group A failures on the first batch (planning Opus tasks at
21:32-21:33Z). The user appears to have canceled lower-priority children in bulk to drain the
pool. Without an automation-driven cancellation log, the *rationale* is not in the system; it
must be captured if the same triage happens again.

**How to fix:** Re-decide on each canceled child individually:

| Type                                        | Children                                                                 | Recommendation                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Genuine deduplication / out-of-scope        | (TBD per child)                                                          | Keep `Canceled`, add comment with reason.                                   |
| Triaged out under load                      | INT-1480 (Critical), INT-1506, INT-1521 (Critical-ish env-var leakage)   | Re-open as `Todo` and re-dispatch in the next planning batch.               |
| Subsumed by a larger refactor               | INT-1518, INT-1522, INT-1523                                             | Re-open and link as blocking / blockedBy of the parent refactor.            |

**How to prevent recurrence:**

* **P10.** Require a comment on the issue when the cancellation reason is "load-shedding".
  Implement a Linear automation (web app side) that prompts for a one-line reason whenever a
  bulk cancellation is initiated.
* **P11.** Add a `cancellationReason` enum (`duplicate | out-of-scope | load-shedding |
  superseded`) to the issue's labels. Today there is no signal whether the task ever should be
  re-attempted.
* **P12.** Have `code-agent` track Linear-level cancellations of issues that have *no* code-task
  yet, and emit a metric so we know how often manual intervention is needed.

---

### Group D — Plan ↔ review ping-pong before terminal failure (excessive retries)

**Symptom:** every dispatched subtask has 7-9 `code_tasks` rows alternating
`planning(opus) → review(glm) → planning(opus) → review(glm) → … → failed`. Earlier rows have
status `archived`; only the last carries `failed`. The PR (e.g., 1951) is opened on the first
planning round; subsequent rounds re-edit the same branch.

**Quantitative view (per subtask):**

| Subtask  | # planning rounds | # review rounds | Final disposition           |
| -------- | ----------------- | --------------- | --------------------------- |
| INT-1529 | 5                 | 4               | failed (worker_unavailable) |
| INT-1530 | 4                 | 3               | failed (TASK_RUNTIME_HARD)  |
| INT-1531 | 4                 | 4               | failed (worker_unavailable) |
| INT-1532 | 4                 | 4               | failed (worker_unavailable) |
| INT-1533 | 4                 | 4               | failed (worker_unavailable) |
| INT-1534 | 4                 | 4               | failed (worker_unavailable) |
| INT-1535 | 3                 | 3               | failed (worker_unavailable) |
| INT-1536 | 4                 | 3               | failed (worker_unavailable) |
| INT-1537 | 4                 | 4               | failed (worker_unavailable) |
| INT-1538 | 4                 | 3               | failed (worker_unavailable) |

This is **independently bad even when no `worker_unavailable` exists**: each round costs an
Opus + a GLM run. INT-1529 alone consumed 9 worker slots before failing.

**Root cause:** the orchestrator's review loop doesn't have a **convergence cap**. The review
agent can continue to request changes indefinitely; the planning agent dutifully revises. Today
there is no maximum retry count for plan-doc review loops in `workers/orchestrator`. Combined
with Group A, the long loop both (a) keeps the worker pool busy and (b) gives more chances for
a single `worker_unavailable` to terminate the chain.

**How to fix in-flight subtasks:** these are all subsumed by the Group A and Group B fixes;
re-dispatching after capacity controls land will let them converge in 1-2 rounds.

**How to prevent recurrence:**

* **P13.** Add `maxReviewRounds` (default `2`) to the planning-with-review state machine in
  `workers/orchestrator/src/services/task-dispatcher.ts`. After two failed reviews, require the
  user to break the tie (Linear comment + label `needs-human-review`) instead of looping.
* **P14.** Make review verdicts include a confidence score. If consecutive review verdicts
  oscillate (`needs-changes` → `approved` → `needs-changes`), short-circuit to human review
  immediately.
* **P15.** Track loop length in a Cloud-Logging-based metric so future spikes are visible.
* **P16.** Reuse the same prior PR branch on retry (already implemented via `retriedFrom`) — but
  also archive the old `archived` `code_tasks` more aggressively (TTL 7d) to reduce Firestore
  read latency.

---

## 3. Cross-cutting prevention checklist

The 16 P-items above should be filed as **separate Linear issues**, NOT subtasks of INT-1560,
because they touch four distinct services. They are listed below grouped by owner so the user
can dispatch them in parallel.

| Owner / service                     | P-items              |
| ----------------------------------- | -------------------- |
| `apps/code-agent`                   | P1, P2, P3, P4, P5   |
| `workers/orchestrator`              | P6, P7, P8, P9       |
| Linear automation (web app side)    | P10, P11, P12        |
| `workers/orchestrator` (review FSM) | P13, P14, P15, P16   |

Each becomes a sibling issue (parent: a new umbrella issue, NOT INT-1560 — INT-1560 is the
investigation-only deliverable).

---

## 4. Endpoint changes

**Modified:** none — investigation-only PR.
**Created:** none.
**Removed:** none.
**Unchanged:** all.

---

## 5. Verification

* [ ] `pnpm run ci:tracked` passes (no source-code changes; markdown only).
* [ ] PR #X opened on branch `plan/int-1560-failure-investigation`.
* [ ] Linear INT-1560 description updated with `Plan document: docs/plans/INT-1560-failed-subtasks-investigation.md`.
* [ ] Original Linear description archived as a comment on INT-1560.
* [ ] User dispatches re-runs / preventive issues at their discretion.
