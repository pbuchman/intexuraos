# PR Comment on Closed/Merged PR — Guard and Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent task resumption failures when `@worker` comments are posted on closed/merged PRs by adding PR state validation to the dispatch flow and falling back to new task creation.

**Architecture:** Add a PR state guard in `gitHubDispatchService.ts` before calling `handleExistingTask()`, and extend `isStaleTaskError()` to treat `session_expired` as a stale condition. When the PR is closed/merged, the system will create a new task on a fresh branch instead of resuming the completed one.

**Tech Stack:** TypeScript, Vitest, Fastify (code-agent app)

---

## Investigation Summary

### What happened

1. PR #1767 ([INT-1352] plan) was **merged** at 13:36:11 UTC on 2026-04-12
2. User posted `@worker opus` comment at 13:45:33 UTC — 9 minutes after merge
3. System triaged correctly as `pr_comment` and dispatched
4. `gitHubDispatchService.dispatch()` found the existing completed planning task
5. Called `handleExistingTask()` which called `sendTaskMessage()` on orchestrator
6. Orchestrator accepted the resume (`worktreeExists` = true, `isResumeAvailable` = true)
7. `startWorkerAttempt()` ran with `continueSession: true` — worker process exited with code 128 (git fatal error)
8. `handleResumedAfterSuccessCompletion()` detected the non-zero exit code and generated `TASK_RESUMED_HARD_ERROR`

### Root cause

**No PR state validation exists in the dispatch flow.** The `dispatch()` method in `gitHubDispatchService.ts` (line 126-178) looks up the latest execution task by PR number and immediately routes to `handleExistingTask()` without checking whether the PR is still open. The event model **already carries** `state` and `mergedAt` fields from the webhook payload, but they are never consulted.

### Why exit code 128

The resumed worker attempted git operations (likely `git fetch` or `git push`) on a worktree whose context was stale after the PR merge. Git returns exit code 128 for fatal errors like attempting to push to a deleted/merged branch reference.

### Key code locations

| Component                | File                                                           | Lines     | Purpose                                                                |
| ------------------------ | -------------------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| Dispatch entry           | `apps/code-agent/src/domain/services/gitHubDispatchService.ts` | 126-178   | `dispatch()` — routes to existing vs new task                          |
| Existing task handler    | same file                                                      | 592-665   | `handleExistingTask()` — sends message to task                         |
| Stale check              | same file                                                      | 425-431   | `isStaleTaskError()` — only checks `task_not_found` and `worker_error` |
| PR event model           | `apps/code-agent/src/domain/models/gitHubPREvent.ts`           | 48-71     | Has `state` and `mergedAt` fields                                      |
| Orchestrator sendMessage | `workers/orchestrator/src/services/task-dispatcher.ts`         | 590-718   | Accepts resume without PR state check                                  |
| Resume hard error        | same file                                                      | 1913-1997 | Generates `TASK_RESUMED_HARD_ERROR`                                    |
| Resume preamble          | same file                                                      | 1801-1844 | Tells agent to check PR state (soft guard, not enforced)               |

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All existing webhook/dispatch endpoints

All changes are internal logic — no endpoint signatures change.

---

## File Structure

| Action   | File                                                                          | Responsibility                                                                   |
| -------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Modify   | `apps/code-agent/src/domain/services/gitHubDispatchService.ts`                | Add PR state guard before `handleExistingTask()` and extend `isStaleTaskError()` |
| Modify   | `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts` | Add tests for closed/merged PR handling                                          |

---

### Task 1: Add PR state guard to dispatch flow

**Files:**
- Test: `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`
- Modify: `apps/code-agent/src/domain/services/gitHubDispatchService.ts:126-178`

The `dispatch()` function currently routes to `handleExistingTask()` whenever an existing task is found for the PR. We need to check the event's PR state first: if the PR is closed or merged, skip `handleExistingTask()` and fall through to `handleNewTask()` instead. This creates a fresh task on a new branch rather than trying to resume a stale completed task.

- [ ] **Step 1: Write the failing test — merged PR with existing task creates new task**

Add a test to `gitHubDispatchService.test.ts` that verifies: when `findLatestExecutionTaskByPR` returns a task but the event's `state` is `'closed'` and `mergedAt` is set, the dispatch service calls `createTaskForPR` (new task) instead of `sendTaskMessage` (existing task).

```typescript
it('creates new task when PR is merged and existing task found', async () => {
  const mergedEvent: GitHubPREvent = {
    ...mockEvent,
    state: 'closed',
    mergedAt: new Date('2026-04-12T13:36:11Z'),
  };

  const existingTask = { id: 'task-existing', userId: 'user-123', linearIssueId: 'INT-1352' };
  mockDeps.codeTaskRepo.findLatestExecutionTaskByPR = vi.fn().mockResolvedValue(ok(existingTask));
  mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-new-123' }));

  const result = await service.dispatch({
    event: mergedEvent,
    logger: mockLogger,
  });

  expect(result.success).toBe(true);
  expect(result.taskId).toBe('task-new-123');
  expect(mockedSendTaskMessage).not.toHaveBeenCalled();
  expect(mockedCreateTaskForPR).toHaveBeenCalled();
});
```

- [ ] **Step 2: Write the failing test — closed (not merged) PR with existing task creates new task**

```typescript
it('creates new task when PR is closed (not merged) and existing task found', async () => {
  const closedEvent: GitHubPREvent = {
    ...mockEvent,
    state: 'closed',
    mergedAt: null,
  };

  const existingTask = { id: 'task-existing', userId: 'user-123' };
  mockDeps.codeTaskRepo.findLatestExecutionTaskByPR = vi.fn().mockResolvedValue(ok(existingTask));
  mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-new-456' }));

  const result = await service.dispatch({
    event: closedEvent,
    logger: mockLogger,
  });

  expect(result.success).toBe(true);
  expect(result.taskId).toBe('task-new-456');
  expect(mockedSendTaskMessage).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Write the failing test — open PR with existing task still routes to existing task**

This confirms the guard does NOT affect normal open-PR flow.

```typescript
it('routes to existing task when PR is open', async () => {
  const openEvent: GitHubPREvent = {
    ...mockEvent,
    state: 'open',
    mergedAt: null,
  };

  const existingTask = { id: 'task-existing', userId: 'user-123' };
  mockDeps.codeTaskRepo.findLatestExecutionTaskByPR = vi.fn().mockResolvedValue(ok(existingTask));
  mockedSendTaskMessage.mockResolvedValue(ok({ action: 'resumed' }));

  const result = await service.dispatch({
    event: openEvent,
    logger: mockLogger,
  });

  expect(result.success).toBe(true);
  expect(mockedSendTaskMessage).toHaveBeenCalled();
  expect(mockedCreateTaskForPR).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`
Expected: The merged/closed tests FAIL because dispatch currently routes to `handleExistingTask()` regardless of PR state.

- [ ] **Step 5: Implement the PR state guard in `dispatch()`**

In `apps/code-agent/src/domain/services/gitHubDispatchService.ts`, modify the `dispatch()` method. After `findLatestExecutionTaskByPR` returns a non-null task (line 152-156), add a PR state check before calling `handleExistingTask()`:

```typescript
// Inside dispatch(), after line 156 (the task === null check):

// If PR is closed or merged, the existing task's context is stale.
// Fall through to new task creation instead of resuming the old task.
if (task !== null && (event.state === 'closed' || event.mergedAt !== null)) {
  logger.info(
    {
      staleTaskId: task.id,
      prNumber: event.pullRequestNumber,
      prState: event.state,
      merged: event.mergedAt !== null,
    },
    'PR is closed/merged — skipping existing task, creating new task'
  );
  return await handleNewTask(deps, event, logger, workerDirective);
}
```

Place this block between the `task === null` early return (line 154-156) and the `handleExistingTask()` call (line 158). The full flow becomes:

```typescript
const task = taskResult.value;

if (task === null) {
  return await handleNewTask(deps, event, logger, workerDirective);
}

// Guard: PR is closed or merged — existing task context is stale
if (event.state === 'closed' || event.mergedAt !== null) {
  logger.info(
    {
      staleTaskId: task.id,
      prNumber: event.pullRequestNumber,
      prState: event.state,
      merged: event.mergedAt !== null,
    },
    'PR is closed/merged — skipping existing task, creating new task'
  );
  return await handleNewTask(deps, event, logger, workerDirective);
}

const existingResult = await handleExistingTask(deps, event, task, logger);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`
Expected: All tests PASS, including the new merged/closed/open tests.

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/services/gitHubDispatchService.ts apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts
git commit -m "feat(code-agent): add PR state guard to prevent task resumption on closed/merged PRs

When a @worker comment is posted on a closed/merged PR, the dispatch service
now creates a new task instead of trying to resume the stale completed task.
This prevents TASK_RESUMED_HARD_ERROR (exit code 128) from git failures on
stale worktrees."
```

---

### Task 2: Extend `isStaleTaskError()` to handle `session_expired`

**Files:**
- Test: `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`
- Modify: `apps/code-agent/src/domain/services/gitHubDispatchService.ts:425-431`

As a defense-in-depth measure, extend `isStaleTaskError()` to recognize `session_expired` as a stale condition. If the Task 1 guard somehow misses (e.g., `state` is null in the event payload — which can happen for older cached events), the fallback path should still work. When `sendTaskMessage()` returns `session_expired`, the dispatch flow should fall back to `handleNewTask()`.

- [ ] **Step 1: Write the failing test — session_expired is treated as stale**

```typescript
it('treats session_expired as stale task error', () => {
  const result: WebhookDispatchResult = {
    success: false,
    dispatched: false,
    error: 'Session has expired — the worker container was cleaned up.',
    errorCode: 'session_expired',
  };
  expect(isStaleTaskError(result)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts -t "session_expired"`
Expected: FAIL — `isStaleTaskError` currently returns false for `session_expired`.

- [ ] **Step 3: Extend `isStaleTaskError()` to include `session_expired`**

In `apps/code-agent/src/domain/services/gitHubDispatchService.ts`, modify `isStaleTaskError()` at line 425-431:

```typescript
export function isStaleTaskError(result: WebhookDispatchResult): boolean {
  if (result.errorCode === 'task_not_found') return true;
  if (result.errorCode === 'session_expired') return true;
  if (result.errorCode === 'worker_error' && result.error !== undefined) {
    return result.error.includes('Task not found') || result.error.includes('HTTP 404');
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/services/gitHubDispatchService.ts apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts
git commit -m "fix(code-agent): treat session_expired as stale task error for fallback

Extends isStaleTaskError() to recognize session_expired, so expired
containers fall through to new task creation instead of returning an error."
```

---

### Task 3: Verify full workspace CI and edge case coverage

**Files:**
- Test: `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`

- [ ] **Step 1: Add edge case test — null state still routes to existing task**

When the event `state` is null (e.g., synthetic or legacy events), the guard should NOT block. The existing behavior (route to existing task) should be preserved.

```typescript
it('routes to existing task when event state is null', async () => {
  const nullStateEvent: GitHubPREvent = {
    ...mockEvent,
    state: null,
    mergedAt: null,
  };

  const existingTask = { id: 'task-existing', userId: 'user-123' };
  mockDeps.codeTaskRepo.findLatestExecutionTaskByPR = vi.fn().mockResolvedValue(ok(existingTask));
  mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));

  const result = await service.dispatch({
    event: nullStateEvent,
    logger: mockLogger,
  });

  expect(result.success).toBe(true);
  expect(mockedSendTaskMessage).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the full workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: All tests pass, coverage thresholds met.

- [ ] **Step 3: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: All workspaces pass.

- [ ] **Step 4: Commit edge case test**

```bash
git add apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts
git commit -m "test(code-agent): add edge case test for null state PR comment dispatch"
```

---

## Design Decisions

### Why guard at dispatch level, not orchestrator level

The dispatch service (`gitHubDispatchService.ts`) is the **earliest point** where PR state is known. The orchestrator's `sendMessage()` has no access to PR state — it only knows about worktrees and containers. Adding the guard at dispatch avoids a wasted round-trip to the orchestrator for a task that will inevitably fail.

### Why create a new task instead of rejecting

The user's `@worker` comment is an explicit request for work. Rejecting it would require the user to manually create a new task. Creating a new task automatically (via `handleNewTask()`) respects the user's intent while routing through the correct branch-creation path.

### Why extend `isStaleTaskError()` as defense-in-depth

The `state` field comes from the GitHub webhook payload. If the webhook is replayed or the state is stale, the primary guard (Task 1) might not fire. The `session_expired` fallback (Task 2) catches the case where the orchestrator itself detects the container is gone — which is a strong signal that resumption is impossible.

### Why NOT add a PR state check to the orchestrator

The orchestrator is a generic task runner — it doesn't know about GitHub PRs. Adding PR-specific logic would violate its responsibility boundary. The dispatch service is the correct place for GitHub-domain decisions.
