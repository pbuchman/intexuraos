# Scheduled Code Task Dispatch and Cooloff Retries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let execution-mode code tasks be scheduled for a future dispatch time while still entering the persistent dispatch queue immediately, and let Claude usage-limit failures auto-create retry tasks that stay queued until the parsed reset time.

**Architecture:** Keep the existing queue-first model. A queued task may optionally carry task-scoped `dispatchSchedule` metadata with an absolute UTC `notBeforeAt`; `drainTaskQueue()` remains the only dispatcher and skips queued tasks until they become eligible. Rate-limit retries reuse the same task-scoped schedule path by creating a new queued retry task whose eligibility time is derived from a dedicated LLM cooldown parser, not from fixed retry timers or issue-group aggregation.

**Tech Stack:** TypeScript, Fastify, Firestore, React, Firebase SDK, Vitest

---

## Problem Statement

The current code-task system treats every queued task as immediately dispatchable once workers are available. That breaks two new requirements:

1. A user needs to create an **execution** task now but request that it only becomes dispatchable at a future date/time.
2. A task that fails with a Claude usage-limit message such as `You've hit your limit · resets 10pm (UTC)` should not burn retries immediately; it should create a retry task that is queued now but cannot be picked up until the parsed reset time.

The current backend already has a distinct `retry_after_cooloff` verdict in `classifyFailure()`, but it does not persist any "not before" timestamp on the queued retry task, so `drainTaskQueue()` has no way to honor a future eligibility window.

## Live Evidence

- Production task `task_ac5fb880-3c0b-44b5-a906-dbedcb41793e` on April 23, 2026 failed with:
  `TASK_RUNTIME_HARD_ERROR: Non-zero exit code: 1; Claude error: You've hit your limit · resets 10pm (UTC)`
- Production task `task_8f4bc53b-37f9-4d9c-a784-0090b207084f` on April 23, 2026 failed with the same reset-string pattern.
- The current retry path (`triageFailedTask -> autoRetryTask -> enqueue`) creates the retry task immediately but has no field that tells the queue drainer to wait until a future dispatch time.

## Key Decisions

1. **Use scheduler-driven natural delay, not per-task timers.**
   Every scheduled task still enters Firestore with `status='queued'` immediately. `drainTaskQueue()` remains the single dispatch gate and skips tasks whose `dispatchSchedule.notBeforeAt` is still in the future.

2. **Store operational scheduling metadata on the `code_tasks` document.**
   The queue drainer, queue API, and queue UI all need the data on the main task record. This metadata does **not** belong in `dispatch_retries`, `log_lines`, or issue-group summaries.

3. **Keep cooldown metadata task-scoped, not issue-group-scoped.**
   Consecutive tasks in the same code-task group must not accumulate or extend a shared cooldown window. Each queued task carries its own absolute eligibility time derived from its own user input or failure evidence.

4. **Use a dedicated LLM parser for usage-limit resets.**
   Reuse the existing `retry_after_cooloff` verdict, but add a separate cooldown-extraction prompt/usecase that returns an absolute UTC timestamp plus a short rationale. This is a system-driven automation path, not the user-driven `retryTask()` flow.

5. **Use the existing user timezone model for UX.**
   The web form should not introduce a second timezone selector. It should use the saved/browser timezone already managed by the web app, show that timezone explicitly next to the picker, and send enough data for the backend to persist an absolute dispatch time plus audit context.

6. **Do not let pre-scheduled wait time consume queue TTL.**
   `drainTaskQueue()` must skip future-scheduled tasks before TTL expiry checks and calculate queue-expiry time from the later of `queuedAt` and `dispatchSchedule.notBeforeAt`.

## Endpoint Changes

### Modified

- `POST /code/submit`
  Adds optional execution-only `scheduledDispatch` input.
- `GET /code/queue`
  Adds future dispatch metadata for queued tasks when available.
- `POST /internal/drain-queue`
  No schema change required, but behavior changes so scheduled tasks are skipped until eligible.

### Created

- None.

### Unchanged

- `POST /code/retry`
- `POST /code/tasks/:taskId/implement`
- `POST /internal/code/submit`
- `POST /internal/code/submit-phase2`
- `POST /internal/webhooks/task-complete`

## Shared Data Contract

### Task document

Add task-scoped scheduling metadata to `CodeTask`:

```ts
export interface DispatchSchedule {
  notBeforeAt: Timestamp;
  source: 'user_scheduled' | 'retry_cooloff';
  timezone?: string;
  localDateTime?: string;
  sourceText?: string;
  derivedBy: 'user_input' | 'llm' | 'fallback';
  derivedFromTaskId?: string;
}

export interface CodeTask {
  // existing fields...
  dispatchSchedule?: DispatchSchedule;
}
```

Implementation notes:

- `notBeforeAt` is the only field `drainTaskQueue()` uses for dispatch gating.
- `timezone` and `localDateTime` are audit/display helpers for user-scheduled tasks.
- `sourceText` captures the short vendor reset string that produced a cooloff retry.
- `derivedFromTaskId` links a retry schedule back to the failed task that produced it.

### Submit API request

Add an optional request field for execution-mode scheduling:

```ts
export interface SubmitCodeTaskRequest {
  prompt: string;
  workerType?: CodeTaskWorkerType;
  linearIssueId?: string;
  taskMode?: 'planning' | 'execution';
  scheduledDispatch?: {
    localDateTime: string;
    timezone: string;
    notBeforeAt: string; // ISO UTC generated by the web app
  };
}
```

Rules:

- `scheduledDispatch` is accepted only when `taskMode === 'execution'`.
- Planning-mode tasks must reject `scheduledDispatch` with `400`.
- `notBeforeAt` must be in the future.
- The backend persists the absolute UTC value and the audit context exactly as received after validation.

### Queue API response

Extend queue rows so the web can render future dispatch information without extra reads:

```ts
interface QueuedTask {
  id: string;
  prompt: string;
  linearIssueId?: string;
  workerType: string;
  agentType?: string;
  queuedAt: string;
  createdAt: string;
  position: number;
  dispatchEligibleAt?: string;
  dispatchScheduleSource?: 'user_scheduled' | 'retry_cooloff';
  dispatchScheduleText?: string;
}
```

`dispatchScheduleText` is a short server-generated label such as:

- `Scheduled by user`
- `Waiting for Claude reset`

## Queue Semantics

- A scheduled task still consumes a queue slot immediately. This matches the requirement that it be "put into dispatch queue immediately."
- `drainTaskQueue()` scans the full queued set up to `config.queue.maxSize` (currently 50), not just the first 10 rows. This avoids front-of-line starvation when older rows are intentionally scheduled for the future.
- A future-scheduled task is skipped silently during drain cycles until `now >= dispatchSchedule.notBeforeAt`.
- Queue TTL uses `effectiveEligibleAt = max(queuedAt, dispatchSchedule.notBeforeAt)` so that a task does not expire before it ever becomes eligible.

## Cooloff Retry Semantics

- `classifyFailure()` keeps the distinct `retry_after_cooloff` verdict.
- `triageFailedTask()` calls a new cooldown parser only for `retry_after_cooloff`.
- The cooldown parser receives:
  - `taskError.code`
  - `taskError.message`
  - recent log lines (when present)
  - user timezone from `userServiceClient.getUserTimezone(task.userId)` for ambiguous reset strings
- The parser returns JSON:

```json
{
  "notBeforeAt": "2026-04-23T22:00:00Z",
  "timezone": "UTC",
  "sourceText": "resets 10pm (UTC)",
  "reason": "Claude usage limit resets at 10:00 PM UTC"
}
```

- `autoRetryTask()` creates the new queued retry task with `dispatchSchedule.source = 'retry_cooloff'`.
- If parsing fails, fall back to a **single explicit fixed delay** (for example 60 minutes) and mark `derivedBy = 'fallback'`. This fallback is only for parser failure; the normal cooloff path remains scheduler-driven from an absolute timestamp.
- The retry chain and `autoRetryAttempt` continue to work as they do today; the change is only when the new retry task becomes eligible for draining.

## Parallel Breakdown

### Subtask A: `code-agent` backend

**Owner:** `apps/code-agent/`

**Contract it owns:**

- `scheduledDispatch` request schema in `POST /code/submit`
- `dispatchSchedule` persistence on `CodeTask`
- `dispatchEligibleAt` fields in `GET /code/queue`
- `retry_after_cooloff` parsing and queued retry scheduling
- TTL and drain semantics for scheduled tasks

**Files in scope:**

- `apps/code-agent/src/domain/models/codeTask.ts`
- `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`
- `apps/code-agent/src/routes/codeRoutes.ts`
- `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- `apps/code-agent/src/domain/usecases/triageFailedTask.ts`
- `apps/code-agent/src/domain/usecases/autoRetryTask.ts`
- `apps/code-agent/src/domain/prompts/` (new cooldown parser prompt)
- `apps/code-agent/src/__tests__/...`

**Independent deliverable:**

- Backend can be implemented and fully tested with mocked queue rows and mocked LLM responses before any web changes land.

### Subtask B: `web` scheduling UX

**Owner:** `apps/web/`

**Contract it consumes:**

- `SubmitCodeTaskRequest.scheduledDispatch`
- Queue-row fields `dispatchEligibleAt`, `dispatchScheduleSource`, `dispatchScheduleText`

**Files in scope:**

- `apps/web/src/types/index.ts`
- `apps/web/src/pages/CodeTaskNewPage.tsx`
- `apps/web/src/components/ConfirmSubmitModal.tsx`
- `apps/web/src/services/codeAgentApi.ts`
- `apps/web/src/pages/DispatchQueuePage.tsx`
- `apps/web/src/hooks/useDispatchQueue.ts`
- `apps/web/src/utils/dateFormat.ts` or a small new schedule-format helper
- `apps/web/src/__tests__/...`

**Independent deliverable:**

- The web agent can build against the agreed API contract using mocked responses; it does not need to wait for backend completion to implement layout, validation, preview copy, or queue-card rendering.

## File Plan

### Code-agent

Modify:

- `apps/code-agent/src/domain/models/codeTask.ts`
- `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`
- `apps/code-agent/src/routes/codeRoutes.ts`
- `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- `apps/code-agent/src/domain/usecases/triageFailedTask.ts`
- `apps/code-agent/src/domain/usecases/autoRetryTask.ts`
- `apps/code-agent/src/domain/utils/classifyFailure.ts`

Create:

- `apps/code-agent/src/domain/prompts/cooloffRetryPrompt.ts`
- `apps/code-agent/src/__tests__/domain/prompts/cooloffRetryPrompt.test.ts`

Test:

- `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`
- `apps/code-agent/src/__tests__/routes/codeQueue.test.ts`
- `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`
- `apps/code-agent/src/__tests__/domain/usecases/triageFailedTask.test.ts`
- `apps/code-agent/src/__tests__/domain/usecases/autoRetryTask.test.ts`
- `apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts`
- `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`

### Web

Modify:

- `apps/web/src/types/index.ts`
- `apps/web/src/pages/CodeTaskNewPage.tsx`
- `apps/web/src/components/ConfirmSubmitModal.tsx`
- `apps/web/src/services/codeAgentApi.ts`
- `apps/web/src/pages/DispatchQueuePage.tsx`
- `apps/web/src/hooks/useDispatchQueue.ts`

Create if needed:

- `apps/web/src/utils/scheduledDispatch.ts`
- `apps/web/src/utils/__tests__/scheduledDispatch.test.ts`

Test:

- `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`
- `apps/web/src/services/__tests__/codeAgentApi.test.ts`
- `apps/web/src/hooks/__tests__/useDispatchQueue.test.ts`

## Implementation Tasks

### Task 1: Extend task persistence for schedule-aware queueing

- [ ] Add `dispatchSchedule` to the `CodeTask` domain model and repository create/update serialization.
- [ ] Persist `dispatchSchedule.notBeforeAt` as a Firestore `Timestamp`.
- [ ] Keep the field optional so legacy tasks remain readable without migration backfill.
- [ ] Add repository tests for round-tripping the new nested object.

### Task 2: Accept execution scheduling on submit

- [ ] Extend `POST /code/submit` schema and request handling with `scheduledDispatch`.
- [ ] Reject scheduling for planning tasks.
- [ ] Persist user-provided schedule data on the new task before enqueue.
- [ ] Keep `/internal/code/submit` unchanged for now.
- [ ] Add route tests for valid scheduled execution, invalid planning schedule, and past timestamps.

### Task 3: Make queue draining schedule-aware

- [ ] Increase drain candidate scan depth from the fixed small batch to the queue max size.
- [ ] Skip future-scheduled tasks before TTL checks.
- [ ] Base TTL expiry on `max(queuedAt, dispatchSchedule.notBeforeAt)`.
- [ ] Continue to honor existing PR-lock behavior by resetting `queuedAt` only for PR-lock waits, not for future schedules.
- [ ] Add drain tests covering:
  - scheduled task skipped until eligible
  - eligible unscheduled task dispatches ahead of older future-scheduled rows
  - TTL does not expire before `notBeforeAt`

### Task 4: Add cooldown parsing for Claude usage-limit retries

- [ ] Add a dedicated prompt/parser for usage-limit reset extraction.
- [ ] Fetch recent logs plus user timezone and call the user-selected LLM only for `retry_after_cooloff`.
- [ ] Validate the returned timestamp is in the future and within sane bounds before using it.
- [ ] Create the retry task with `dispatchSchedule.source = 'retry_cooloff'`.
- [ ] Add a parser-failure fallback delay and mark it explicitly as `derivedBy = 'fallback'`.
- [ ] Add tests for the exact production message `You've hit your limit · resets 10pm (UTC)`.

### Task 5: Add scheduling UX to the new-task form

- [ ] Add a collapsed-by-default "Schedule this execution" toggle that only appears in execution mode.
- [ ] Use the existing user/browser timezone and show it next to the control.
- [ ] Use a date+time control with:
  - minimum value of "now"
  - inline validation for past times
  - live preview such as `Dispatches Apr 24, 2026, 10:00 PM UTC`
- [ ] Show helper copy that the task joins the queue immediately but will not dispatch before the selected time.
- [ ] Surface scheduled metadata in `ConfirmSubmitModal`.

### Task 6: Show future dispatch metadata in the queue UI

- [ ] Extend queue API types with `dispatchEligibleAt` and source text.
- [ ] On `DispatchQueuePage`, render a second time row when a task has future dispatch metadata:
  - `Dispatches Apr 24, 2026, 10:00 PM UTC`
  - `Waiting for Claude reset` or `Scheduled by user`
- [ ] Keep the existing queued timestamp visible so users can distinguish queue-entry time from dispatch-eligibility time.
- [ ] Do not add issue-group-level cooldown badges in this task; keep the metadata queue-only and task-scoped.

## Acceptance Criteria

- A user can submit an execution task with a future dispatch time from the web UI.
- That task appears in `GET /code/queue` immediately with its future eligibility time.
- `drainTaskQueue()` does not dispatch the task before `dispatchSchedule.notBeforeAt`.
- A Claude usage-limit failure creates a new queued retry task whose future eligibility time is parsed into absolute UTC.
- The queue page shows both queue-entry time and future dispatch time when present.
- Cooloff metadata is stored per task and does not become a rolling issue-group-level backoff.

## Verification

- `pnpm --filter @intexuraos/code-agent test -- src/__tests__/routes/codeSubmit.test.ts src/__tests__/routes/codeQueue.test.ts src/__tests__/domain/usecases/drainTaskQueue.test.ts src/__tests__/domain/usecases/triageFailedTask.test.ts src/__tests__/domain/usecases/autoRetryTask.test.ts src/__tests__/domain/utils/classifyFailure.test.ts`
- `pnpm --filter web test -- --run CodeTaskNewPage useDispatchQueue codeAgentApi`
- `pnpm run verify:workspace:tracked -- code-agent`
- `pnpm run verify:workspace:tracked -- web`
- `pnpm run ci:tracked`

## Non-Goals

- No change to orchestrator runtime behavior or worker containers.
- No separate scheduled-task collection or dedicated scheduled queue.
- No issue-group summary aggregation of cooldown windows.
- No redesign of the code-task detail page beyond data needed for queue rendering.
