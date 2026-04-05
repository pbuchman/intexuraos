# Stale Task Message Retry Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a PR comment is dispatched to an existing task whose worker is dead, fall back to creating a new task instead of silently dropping the message.

**Architecture:** The fix targets two code paths in the code-agent dispatch pipeline: (1) the synchronous `handleExistingTask` path where `worker_unavailable` errors are currently queued for retry with an optimistic `success: true` that prevents the stale-task fallback from firing, and (2) the async `handleTaskMessageRetry` drain-queue path where permanently failed messages are silently deleted with no fallback to new task creation. The fix converts both paths to detect stale tasks and create new tasks.

**Tech Stack:** TypeScript, Fastify, Vitest, Firestore

---

## Root Cause Analysis

**Incident:** User comment on PR #1650 at 08:53:01Z never triggered a PR task.

**Trace:**
1. GitHub webhook delivered `issue_comment` event to code-agent
2. LLM triage decided: dispatch as `pr_comment`
3. `dispatch()` found existing task `task_0b2a7eee` for PR 1650 (the original planning task)
4. `handleExistingTask()` called `sendTaskMessage()` -> failed with `worker_unavailable` (HTTP 530)
5. `worker_unavailable` is in `RETRYABLE_ERROR_CODES` -> message queued for retry
6. **BUG 1:** `handleExistingTask()` returned `{ success: true, dispatched: true }` (line 636), so the `isStaleTaskError()` fallback on line 161 never fired
7. Retry queue picked it up -> `handleTaskMessageRetry()` sent to worker -> got `worker_error` + "Task not found" (HTTP 404)
8. `worker_error` is NOT retryable -> entry permanently deleted
9. **BUG 2:** `handleTaskMessageRetry()` has no fallback to create a new task -- message silently dropped

**Two bugs:**
- **Bug 1 (handleExistingTask):** Returns `success: true` when queuing a retry for a potentially dead worker, which bypasses the existing stale-task fallback in the caller
- **Bug 2 (handleTaskMessageRetry):** When a `task_message` retry permanently fails with a stale-task indicator (task_not_found, worker_error with "Task not found"), it deletes the retry entry and returns `failed` with no fallback to new task creation

## Fix Strategy

**Bug 1 fix:** In `handleExistingTask`, when the initial `sendTaskMessage` fails with a retryable error AND the retry is queued, return `{ success: true }` as today (the retry queue will handle it). No change needed here -- the retry queue is the right place to handle this.

**Bug 2 fix (primary):** In `handleTaskMessageRetry`, when a non-retryable error indicates the task is stale (using the same `isStaleTaskError` logic), convert the `task_message` retry entry into a `new_task` dispatch instead of silently dropping it. The retry entry already contains `repository`, `pullRequestNumber`, `senderLogin`, and `message` -- everything needed to call `createTaskForPR`.

## File Structure

| File                                                                    | Action    | Responsibility                                                           |
| ----------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`                | Modify    | Add stale-task detection + new task fallback in `handleTaskMessageRetry` |
| `apps/code-agent/src/domain/services/gitHubDispatchService.ts`          | Read-only | Import `isStaleTaskError` (already exported)                             |
| `apps/code-agent/src/domain/usecases/createTaskForPR.ts`                | Read-only | Used to create fallback task                                             |
| `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts` | Modify    | Add test for stale-task fallback                                         |

---

### Task 1: Add stale-task detection test to drainRetryQueue

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`

- [ ] **Step 1: Write the failing test for stale task_message fallback**

Add this test inside the `describe('task_message retry', ...)` block (after the existing "deletes entry on non-retryable send failure" test at line ~1113):

```typescript
it('creates new task when message retry fails with stale task error (worker_error + Task not found)', async () => {
  mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
  mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
  mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
    err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
  );

  const result = await drainRetryQueue(buildDeps());

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.action).toBe('stale_task_fallback');
  expect(result.value.taskId).toBeDefined();
  expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
});

it('creates new task when message retry fails with task_not_found code', async () => {
  mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
  mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
  mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
    err({ code: 'task_not_found', message: 'Task task_xyz not found' })
  );

  const result = await drainRetryQueue(buildDeps());

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.action).toBe('stale_task_fallback');
  expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`

Expected: FAIL -- `'failed' !== 'stale_task_fallback'`

- [ ] **Step 3: Commit failing tests**

```bash
git add apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts
git commit -m "test(code-agent): add failing tests for stale task message retry fallback"
```

---

### Task 2: Add `stale_task_fallback` action to DrainRetryQueueResult

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`

- [ ] **Step 1: Update the action union type**

In `drainRetryQueue.ts` at line 42, add `'stale_task_fallback'` to the action union:

```typescript
// Before:
export interface DrainRetryQueueResult {
  action: 'dispatched' | 'message_sent' | 'expired' | 'exhausted' | 'retry_failed' | 'failed' | 'empty' | 'skipped';
  taskId?: string;
  locksToCleanup?: LockCleanupInfo[];
}

// After:
export interface DrainRetryQueueResult {
  action: 'dispatched' | 'message_sent' | 'expired' | 'exhausted' | 'retry_failed' | 'failed' | 'empty' | 'skipped' | 'stale_task_fallback';
  taskId?: string;
  locksToCleanup?: LockCleanupInfo[];
}
```

- [ ] **Step 2: Add imports for stale-task detection and task creation**

At the top of `drainRetryQueue.ts`, add these imports:

```typescript
import { isStaleTaskError } from '../services/gitHubDispatchService.js';
import type { SendTaskMessageErrorCode } from '../usecases/sendTaskMessage.js';
```

Also add new deps to `DrainRetryQueueDeps` for creating fallback tasks. Add these fields:

```typescript
export interface DrainRetryQueueDeps {
  // ... existing fields ...
  createTaskForPRFn?: (request: {
    repository: string;
    prNumber: number;
    senderLogin: string;
    comment: string;
    eventId: string;
  }) => Promise<Result<{ taskId: string }, { code: string; message: string }>>;
}
```

- [ ] **Step 3: Implement stale-task fallback in handleTaskMessageRetry**

In the `handleTaskMessageRetry` function, replace the non-retryable error block (lines 435-438):

```typescript
// Before:
    // Non-retryable
    await dispatchRetryRepo.delete(entry.id);
    logger.warn({ retryId: entry.id, error: sendResult.error }, 'Message retry failed permanently');
    return ok({ action: 'failed', taskId: entry.taskId });

// After:
    // Check if this is a stale task (worker says task doesn't exist anymore)
    const staleCheck: { success: false; dispatched: false; errorCode?: SendTaskMessageErrorCode; error?: string } = {
      success: false,
      dispatched: false,
      errorCode: sendResult.error.code as SendTaskMessageErrorCode,
      error: sendResult.error.message,
    };

    if (isStaleTaskError(staleCheck) && deps.createTaskForPRFn !== undefined) {
      logger.info(
        { retryId: entry.id, staleTaskId: entry.taskId, prNumber: entry.pullRequestNumber },
        'Message retry detected stale task, falling back to new task creation'
      );

      const createResult = await deps.createTaskForPRFn({
        repository: entry.repository,
        prNumber: entry.pullRequestNumber,
        senderLogin: entry.senderLogin,
        comment: entry.message ?? '',
        eventId: entry.eventId,
      });

      await dispatchRetryRepo.delete(entry.id);

      if (createResult.ok) {
        logger.info(
          { newTaskId: createResult.value.taskId, staleTaskId: entry.taskId },
          'Created fallback task after stale task message retry'
        );
        return ok({ action: 'stale_task_fallback', taskId: createResult.value.taskId });
      }

      logger.error(
        { error: createResult.error, staleTaskId: entry.taskId },
        'Failed to create fallback task after stale task message retry'
      );
      return ok({ action: 'failed', taskId: entry.taskId });
    }

    // Non-retryable and not stale — drop permanently
    await dispatchRetryRepo.delete(entry.id);
    logger.warn({ retryId: entry.id, error: sendResult.error }, 'Message retry failed permanently');
    return ok({ action: 'failed', taskId: entry.taskId });
```

- [ ] **Step 4: Run the tests**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`

Expected: The new tests still fail because we need to wire `createTaskForPRFn` in the test deps.

- [ ] **Step 5: Commit implementation**

```bash
git add apps/code-agent/src/domain/usecases/drainRetryQueue.ts
git commit -m "feat(code-agent): add stale task fallback in message retry queue"
```

---

### Task 3: Wire createTaskForPRFn in tests and production

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts` (or wherever `drainRetryQueue` is called with deps)

- [ ] **Step 1: Add createTaskForPRFn mock to drainRetryQueue tests**

In the test file, add a mock for `createTaskForPRFn` in the `buildDeps()` helper:

```typescript
const mockCreateTaskForPRFn = vi.fn();

// Inside buildDeps():
function buildDeps(): DrainRetryQueueDeps {
  return {
    // ... existing deps ...
    createTaskForPRFn: mockCreateTaskForPRFn,
  };
}
```

In the `beforeEach`, reset the mock:

```typescript
beforeEach(() => {
  // ... existing resets ...
  mockCreateTaskForPRFn.mockReset();
  mockCreateTaskForPRFn.mockResolvedValue(ok({ taskId: 'task_fallback_new' }));
});
```

Update the two new tests to verify `createTaskForPRFn` was called correctly:

```typescript
it('creates new task when message retry fails with stale task error (worker_error + Task not found)', async () => {
  mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
  mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
  mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
    err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
  );
  mockCreateTaskForPRFn.mockResolvedValue(ok({ taskId: 'task_fallback_new' }));

  const result = await drainRetryQueue(buildDeps());

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.action).toBe('stale_task_fallback');
  expect(result.value.taskId).toBe('task_fallback_new');
  expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
  expect(mockCreateTaskForPRFn).toHaveBeenCalledWith(expect.objectContaining({
    repository: 'pbuchman/intexuraos',
    prNumber: 42,
    senderLogin: 'testuser',
  }));
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`

Expected: PASS

- [ ] **Step 3: Wire createTaskForPRFn in the production code**

Find where `drainRetryQueue` is called with its deps (likely in `apps/code-agent/src/routes/codeRoutes.ts` or a route handler for `/internal/drain-queue`). Search for `drainRetryQueue(` to locate the call site.

Wire in the `createTaskForPRFn` dependency by creating a closure that calls `createTaskForPR` with the services from `getServices()`:

```typescript
import { createTaskForPR } from '../domain/usecases/createTaskForPR.js';

// In the drain-queue handler, when building deps:
createTaskForPRFn: async (request) => {
  const services = getServices();
  return createTaskForPR(
    {
      logger: services.logger,
      codeTaskRepo: services.codeTaskRepo,
      userLookupService: services.userLookupService,
      linearIssueService: services.linearIssueService,
      taskEnqueueService: services.taskEnqueueService,
      whatsappNotifier: services.whatsappNotifier,
      orchestratorSecret: loadConfig().orchestratorSecret,
      gitHubPRClient: services.gitHubPRClient,
      userServiceClient: services.userServiceClient,
      firestore: services.firestore,
      automationLog: services.automationLog,
      workerSettingsRepo: services.workerSettingsRepo,
    },
    {
      repository: request.repository,
      prNumber: request.prNumber,
      senderLogin: request.senderLogin,
      comment: request.comment,
      eventId: request.eventId,
    },
  );
},
```

Note: Read the actual call site first to determine exact import paths and available services. The above is the pattern -- adapt to whatever dependency injection style the call site uses.

- [ ] **Step 4: Run the full code-agent test suite**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

Expected: All tests pass.

- [ ] **Step 5: Commit wiring**

```bash
git add apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts apps/code-agent/src/routes/codeRoutes.ts
git commit -m "feat(code-agent): wire createTaskForPRFn for stale task fallback in drain queue"
```

---

### Task 4: Add test for fallback failure path

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`

- [ ] **Step 1: Write test for createTaskForPRFn failure during stale fallback**

```typescript
it('returns failed when stale task fallback createTaskForPRFn fails', async () => {
  mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
  mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
  mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
    err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
  );
  mockCreateTaskForPRFn.mockResolvedValue(err({ code: 'internal_error', message: 'Linear issue creation failed' }));

  const result = await drainRetryQueue(buildDeps());

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.action).toBe('failed');
  expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
});

it('falls through to permanent failure when stale but no createTaskForPRFn configured', async () => {
  mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
  mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
  mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
    err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
  );

  // Build deps WITHOUT createTaskForPRFn
  const depsWithoutFallback: DrainRetryQueueDeps = {
    ...buildDeps(),
    createTaskForPRFn: undefined,
  };

  const result = await drainRetryQueue(depsWithoutFallback);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.action).toBe('failed');
  expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
});
```

- [ ] **Step 2: Run tests**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts
git commit -m "test(code-agent): add edge case tests for stale task fallback failure paths"
```

---

### Task 5: Run full CI and verify

- [ ] **Step 1: Build packages**

Run: `cd /repo && pnpm build`

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`

Expected: All checks pass.

- [ ] **Step 3: Final commit if any lint/coverage fixes needed**

Fix any issues found by CI and commit.

---

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** `POST /internal/drain-queue` (behavior change: stale task_message retries now create new tasks instead of silently failing)
