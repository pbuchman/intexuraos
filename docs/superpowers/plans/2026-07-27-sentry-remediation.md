# Sentry and Current Dispatch Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Home Dev Sentry crash loop, make Dispatch Queue show only blockers that still affect queued tasks, preserve precise task-level diagnostics, suppress expected dispatch outcomes from Sentry, then merge, deploy, and prove the incident is closed.

**Architecture:** Keep worker capability checks strict and leave Home Dev authentication unchanged. Persist aggregate dispatch statuses only for recoverable blockers whose tasks remain queued; store terminal outcomes only on the affected task and resolve any earlier aggregate. Treat known capability blockers as structured operational logs with `_skipSentry: true`, while unexpected internal failures continue to reach Sentry.

**Tech Stack:** TypeScript, Node.js, Fastify, Firestore, React, Vitest, PM2, GitHub Actions, Sentry API.

## Global Constraints

- Branch from `origin/development`; PR target is `development`.
- Do not install or refresh Codex/Claude authentication.
- Do not change `defaultSentryWorkerType`.
- Follow RED/GREEN test-first development for every production behavior change.
- Run `pnpm run verify:workspace:tracked code-agent`, `pnpm run verify:workspace:tracked web`, and `pnpm run ci:tracked` before commit.
- Preserve task logs, PR comments, WhatsApp notifications, and task-level terminal diagnostics.
- Resolve a Sentry group only after its fix is deployed and verified.
- Use the `$commit-push` no-Linear exception text in the PR body.

## Endpoint Changes

- Modified: none.
- Created: none.
- Removed: none.
- Unchanged: all endpoints, request fields, response fields, authentication, and status codes.

---

### Task 1: Stop the Home Dev `user-service` crash loop

**Files:**
- Modify: `scripts/__tests__/ecosystem.config.test.ts`
- Modify: `ecosystem.config.cjs`

**Interfaces:**
- Consumes: Home Dev PM2 service environment.
- Produces: `user-service` with reads disabled and its required `hetzner-prod` audience; `intex-agent` retains the Home Dev Matrix tuple.

- [x] **Step 1: Write the failing configuration test**

```ts
expect(userService[TEST_RUNS_READ_FLAG]).toBe('false');
expect(userService.INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE).toBe('hetzner-prod');
expect(intexAgent[TEST_RUNS_READ_FLAG]).toBe('true');
expect(intexAgent.INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE).toBe('home-dev');
```

- [x] **Step 2: Verify RED**

Run `pnpm exec vitest run scripts/__tests__/ecosystem.config.test.ts`.
Expected: the user-service audience/read assertions fail against the original Home Dev values.

- [x] **Step 3: Implement the minimal PM2 configuration**

```js
INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED: 'false',
INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'hetzner-prod',
INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID:
  process.env.INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID,
```

- [x] **Step 4: Verify GREEN and the environment contract**

Run the test and `node scripts/verify-env-vars.mjs`. Expected: both pass.

### Task 2: Persist aggregates only for recoverable queue blockers

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/services/codeTaskDispatchStatusService.test.ts`
- Modify: `apps/code-agent/src/domain/services/codeTaskDispatchStatusService.ts`

**Interfaces:**
- Consumes: `RecordCodeTaskDispatchBlockedInput`.
- Produces: `recordDispatchBlocked()` that calls `statusRepo.upsertActive()` only when `isTerminalDispatchBlockerReason(reason) === false`.

- [x] **Step 1: Write a failing terminal-blocker test**

```ts
await service.recordDispatchBlocked({
  userId: 'user-1',
  workerType: 'codex-xhigh',
  blocker: BLOCKER,
  affectedTaskCount: 1,
  exampleTaskIds: ['task-1'],
});
expect(statusRepo.upsertActive).not.toHaveBeenCalled();
```

- [x] **Step 2: Run the service test and confirm RED**

Run `pnpm --filter @intexuraos/code-agent exec vitest run src/__tests__/domain/services/codeTaskDispatchStatusService.test.ts`.
Expected: `upsertActive` was called for `codex_auth_unavailable`.

- [x] **Step 3: Add the terminal guard before the repository call**

Import `isTerminalDispatchBlockerReason` and return immediately for terminal reasons. Do not log an error for this expected no-op.

- [x] **Step 4: Verify GREEN and preserve recoverable coverage**

Keep the existing upsert test but use `workers_at_capacity`; run the service test and expect all tests to pass.

### Task 3: Start a fresh timestamp for a recurring incident

**Files:**
- Modify: `apps/code-agent/src/__tests__/infra/firestore/codeTaskSystemStatusRepository.test.ts`
- Modify: `apps/code-agent/src/infra/firestore/codeTaskSystemStatusRepository.ts`

**Interfaces:**
- Consumes: an existing status document and a new `upsertActive()` observation.
- Produces: preserved `firstSeenAt` for an already-active incident; fresh `firstSeenAt` and no `resolvedAt` for a resolved incident that recurs.

- [x] **Step 1: Write a failing reactivation test**

Seed a resolved document, advance fake time, call `upsertActive()`, and assert:

```ts
expect(result.value.firstSeenAt).toEqual(newOccurrence);
expect(result.value.resolvedAt).toBeUndefined();
```

- [x] **Step 2: Run the repository test and confirm RED**

Expected: the old first timestamp is preserved.

- [x] **Step 3: Implement status-aware timestamp selection**

```ts
const firstSeenAt = existingData?.status === 'active'
  ? toDate(existingData.firstSeenAt)
  : now;
```

Build a fresh active document without spreading `resolvedAt`.

- [x] **Step 4: Verify GREEN**

Run the repository test and confirm both active preservation and recurrence reset pass.

### Task 4: Resolve aggregates when blocked tasks leave the queue

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/drainRetryQueue.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`

**Interfaces:**
- Consumes: successful terminal task updates for a user/worker type.
- Produces: `resolveDispatchBlockers({ userId, workerType })` after the last affected queued task is failed, expired, or retry-exhausted.

- [x] **Step 1: Add failing main-queue assertions**

For terminal no-worker and terminal auth-blocker cases, assert that task failure updates happen before:

```ts
expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith({
  userId: task.userId,
  workerType: task.workerType,
});
```

- [x] **Step 2: Confirm main-queue RED**

Run only `drainTaskQueue.test.ts`; expected missing resolve calls.

- [x] **Step 3: Resolve after successful terminal updates**

Call the existing `resolveDispatchBlockersForTask()` after `failAffectedTasksForDispatchProblem()` succeeds, including the no-enabled-worker path and queue-timeout completion. Never resolve before task persistence succeeds.

- [x] **Step 4: Add failing retry-queue assertions and implement the same ordering**

Cover terminal retry blockers, retry expiry, and exhaustion. Reuse one focused helper that catches aggregate-resolution failures without changing the task result.

- [x] **Step 5: Verify both suites GREEN**

Run both use-case test files.

### Task 5: Keep expected dispatch blockers out of Sentry

**Files:**
- Modify: `apps/code-agent/src/__tests__/infra/services/taskDispatcherImpl.test.ts`
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- Modify if the audit finds equivalent logs: `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`, `apps/code-agent/src/routes/code/task-routes.ts`, and their existing tests.

**Interfaces:**
- Consumes: classified dispatch blocker metadata.
- Produces: structured warning logs with `[SKIP_SENTRY_KEY]: true` for known domain blockers; unexpected internal dispatch failures remain capturable.

- [x] **Step 1: Change the existing critical-blocker test to expect RED**

```ts
expect(logger.warn).toHaveBeenCalledWith(
  expect.objectContaining({ reason: 'workers_unreachable', _skipSentry: true }),
  'Dispatch blocked by worker capability or health state',
);
```

Add an auth-unavailable case because it produced the observed Sentry group.

- [x] **Step 2: Confirm RED**

Run `taskDispatcherImpl.test.ts`; expected current `_skipSentry: false`.

- [x] **Step 3: Mark classified blockers as expected while preserving invalid health responses**

Set `[SKIP_SENTRY_KEY]: true` for classified domain outcomes. Compute malformed/incompatible diagnostics from the complete worker-health result, keep those warnings capturable, and report them even when another worker can dispatch the task. Do not suppress later network exceptions.

- [x] **Step 4: Cover the terminal drain outcome**

For `dispatchError.blocker !== undefined`, log a warning carrying `taskId`, `workerType`, `reason`, `terminal: true`, and `_skipSentry: true`. Preserve `logger.error` without the marker for terminal errors that have no classified blocker.

- [x] **Step 5: Audit every classified-blocker call site**

Add the marker to the direct-submit/no-enabled-worker and retry/no-enabled-worker operational warnings. Keep persistence and notification delivery failures capturable.

- [x] **Step 6: Verify GREEN**

Run the dispatcher, main queue, retry queue, and route tests.

### Task 6: Show precise live timing and affected-task links

**Files:**
- Modify: `apps/web/src/__tests__/DispatchQueuePage.test.tsx`
- Modify: `apps/web/src/pages/DispatchQueuePage.tsx`

**Interfaces:**
- Consumes: existing `firstSeenAt`, `lastSeenAt`, and `exampleTaskIds` from `useDispatchQueue()`.
- Produces: mobile-safe banner details and task links; no API/schema change.

- [x] **Step 1: Write the failing UI test**

Freeze time and assert the banner includes `Blocked since`, an absolute first occurrence, `Last checked`, a relative last occurrence, and links to `/code-tasks/task-1` and `/code-tasks/task-2`.

- [x] **Step 2: Confirm RED**

Run `pnpm --filter @intexuraos/web exec vitest run src/__tests__/DispatchQueuePage.test.tsx`.

- [x] **Step 3: Render timing and links with existing utilities**

Use `formatAbsoluteDateTime(status.firstSeenAt)` and `formatRelative(status.lastSeenAt)`. Put the exact last time in `title`. Render at most the IDs already supplied by `exampleTaskIds`.

- [x] **Step 4: Verify GREEN and mobile layout**

Run the UI test. Ensure empty queue plus zero active statuses renders only the existing empty card.

### Task 7: Full verification and code review

**Files:** all intended changes and both design/plan documents.

- [x] **Step 1: Run targeted workspace verification**

```bash
pnpm run verify:workspace:tracked code-agent
pnpm run verify:workspace:tracked web
```

- [x] **Step 2: Run full CI**

Run `pnpm run ci:tracked`. Expected: all typechecks, lint, validation, tests, coverage, build, and format pass.

- [x] **Step 3: Review the complete diff**

Confirm no auth/default-worker changes, no API schema changes, and no suppression of unexpected errors.

- [x] **Step 4: Apply review findings and rerun the affected tests plus full CI**

All Critical/Important review findings are fixed and the independent re-review returned `ready`. Targeted verification is green; the final full-CI rerun remains.

### Task 8: Publish, merge, deploy, and close Sentry

**Files:** no additional source files unless deployment verification identifies a regression.

- [x] **Step 1: Fetch `origin/development`, rebase if needed, and rerun full CI**
- [ ] **Step 2: Commit intended files and push the feature branch**
- [ ] **Step 3: Open a ready PR targeting `development` with the no-Linear exception text**
- [ ] **Step 4: Wait for required GitHub checks, then merge the PR**
- [ ] **Step 5: Verify automatic Home Dev and Hetzner deployment of the merge revision**
- [ ] **Step 6: Confirm PM2/service health and no `user-service` restart loop**
- [ ] **Step 7: Confirm the referenced tasks are terminal and resolve the two stale active aggregate documents**
- [ ] **Step 8: Reproduce the intended missing-auth path and verify task-level diagnostics with no active Dispatch Queue banner**
- [ ] **Step 9: Query all Sentry projects after the deployment timestamp, observe a bounded quiet window, and resolve only verified fixed/suppressed groups**
- [ ] **Step 10: Report commit, PR, merge revision, deployment runs, health evidence, Sentry counts, and every resolved/suppressed issue**
