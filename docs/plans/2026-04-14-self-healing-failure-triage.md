# Self-Healing Failure Triage Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically classify and retry transient task failures without user intervention, reducing the 68% of infrastructure failures that currently require manual retries.

**Architecture:** A `triageFailedTask` use case intercepts the `task-complete` webhook's failure path. A pure `classifyFailure` function determines the verdict (`retry`, `retry_after_cooloff`, `ask_gemini`, `fail`). Retryable failures create a new auto-retry task (via a new `autoRetryTask` use case) with `failedWorkerLocation` set, which flows through the existing `drainTaskQueue` + `taskDispatcherImpl` dispatch path. The dispatcher filters out the failed worker during health probe processing. Gemini is called only for ambiguous `*_ENFORCEMENT_FAILED` errors.

**Tech Stack:** TypeScript (strict mode), Fastify routes, Firestore, `@intexuraos/llm-factory` (Gemini 2.5 Flash), `@intexuraos/common-core` Result type, WhatsApp Pub/Sub notifications

---

## Verification Notes (codebase audit)

The original issue design had several assumptions that don't match the current codebase. This plan corrects them:

| Original Assumption                      | Actual Codebase                                                                                          | Corrected Approach                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Worker selection is in `drainTaskQueue`  | Worker selection is in `taskDispatcherImpl.ts` (health probe -> capacity sort -> sequential dispatch)    | Add `failedWorkerLocation` to `DispatchRequest` and filter in `taskDispatcherImpl.ts`                            |
| `retryTask` can be reused for auto-retry | `retryTask` is user-initiated with cool-off, ownership validation, Linear state updates, PR continuation | Create a separate `autoRetryTask` use case (lighter, system-initiated)                                           |
| `retriedFrom` is a chain                 | `retriedFrom` is a single-hop string field pointing to the original task ID                              | Walk the chain via Firestore reads: task -> retriedFrom -> that task's retriedFrom -> ...                        |
| `drainRetryQueue` not mentioned          | Existing `drainRetryQueue.ts` handles transient DISPATCH failures (worker_unavailable, network_error)    | Clearly distinguish: `drainRetryQueue` = dispatch-time transient failures; new triage = task-completion failures |

## File Structure

### New Files

| File                                           | Responsibility                                                 |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `src/domain/utils/classifyFailure.ts`          | Pure failure classifier function (~40 lines)                   |
| `src/domain/utils/classifyFailure.test.ts`     | Tests for classifier (all 11 error codes + edge cases)         |
| `src/domain/usecases/autoRetryTask.ts`         | System-initiated auto-retry use case                           |
| `src/domain/usecases/autoRetryTask.test.ts`    | Tests for auto-retry creation, budget check, chain walking     |
| `src/domain/usecases/triageFailedTask.ts`      | Orchestrates triage: classify -> budget check -> retry or fail |
| `src/domain/usecases/triageFailedTask.test.ts` | Tests for triage orchestration including Gemini path           |
| `src/domain/prompts/failureTriagePrompt.ts`    | Gemini prompt for `*_ENFORCEMENT_FAILED` triage                |

### Modified Files

| File                                                    | Change                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/domain/models/codeTask.ts`                         | Add `failedWorkerLocation?: string` and `autoRetryAttempt?: number` to `CodeTask` |
| `src/domain/repositories/codeTaskRepository.ts`         | Add `failedWorkerLocation` and `autoRetryAttempt` to `CreateTaskInput`            |
| `src/infra/repositories/firestoreCodeTaskRepository.ts` | Serialize/deserialize `failedWorkerLocation` and `autoRetryAttempt`               |
| `src/domain/services/taskDispatcher.ts`                 | Add `failedWorkerLocation?: string` to `DispatchRequest`                          |
| `src/infra/services/taskDispatcherImpl.ts:180-186`      | Filter out `failedWorkerLocation` during health probe result processing           |
| `src/domain/services/whatsappNotifier.ts`               | Add `notifyTaskAutoRetried` method to interface                                   |
| `src/infra/services/whatsappNotifierImpl.ts`            | Implement `notifyTaskAutoRetried`                                                 |
| `src/routes/webhookRoutes.ts:1702-1786`                 | Insert triage call before standard failure update                                 |
| `src/services.ts`                                       | Wire `triageFailedTask` deps (Gemini client, log line repo)                       |
| `src/domain/usecases/drainTaskQueue.ts:435-462`         | Thread `failedWorkerLocation` into dispatch request                               |

---

## Task 1: Failure Classifier (pure function)

**Files:**
- Create: `apps/code-agent/src/domain/utils/classifyFailure.ts`
- Test: `apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import { classifyFailure, type FailureVerdict } from '../../../domain/utils/classifyFailure.js';

describe('classifyFailure', () => {
  // Infrastructure — always retry
  it.each([
    ['SETUP_FAILED', 'Docker tmpfs mount failed'],
    ['dispatch_failed', 'Worker returned 503'],
    ['queue_timeout', 'Task exceeded queue TTL'],
    ['queue_full', 'Queue capacity exceeded'],
    ['worker_unavailable', 'All worker health probes failed'],
    ['network_error', 'Connection refused'],
  ])('returns "retry" for infrastructure error code "%s"', (code, message) => {
    expect(classifyFailure(code, message)).toBe('retry' satisfies FailureVerdict);
  });

  // Container crash with OOM/SIGKILL (exit 137)
  it.each([
    ['TASK_RESUMED_HARD_ERROR', 'Process exited with exit code: 137'],
    ['TASK_FATAL_EXIT_CODE', 'Worker process terminated with signal 137'],
    ['TASK_COMPLETION_VERIFICATION_FAILED', 'fatal_exit_code_137: container killed'],
  ])('returns "retry" for exit-137 pattern in code "%s"', (code, message) => {
    expect(classifyFailure(code, message)).toBe('retry' satisfies FailureVerdict);
  });

  // Container stopped / Docker issues
  it.each([
    ['RESUME_ATTEMPT_FAILED', 'Container returned 409 Conflict'],
    ['RESUME_ATTEMPT_FAILED', 'Docker request timed out after 30s'],
  ])('returns "retry" for Docker transient in code "%s"', (code, message) => {
    expect(classifyFailure(code, message)).toBe('retry' satisfies FailureVerdict);
  });

  // Rate limit — retry after cooloff
  it('returns "retry_after_cooloff" for 429 rate limit', () => {
    expect(classifyFailure('TASK_RESUMED_HARD_ERROR', 'API returned 429 Too Many Requests'))
      .toBe('retry_after_cooloff' satisfies FailureVerdict);
  });

  // AI quality failures — ask Gemini
  it.each([
    ['EXECUTION_AGENT_ENFORCEMENT_FAILED', 'Missing required output fields'],
    ['PLANNING_AGENT_ENFORCEMENT_FAILED', 'Plan document not found'],
    ['PULL_REQUEST_AGENT_ENFORCEMENT_FAILED', 'PR URL missing from output'],
    ['REVIEW_AGENT_ENFORCEMENT_FAILED', 'Review summary missing'],
  ])('returns "ask_gemini" for enforcement code "%s"', (code, message) => {
    expect(classifyFailure(code, message)).toBe('ask_gemini' satisfies FailureVerdict);
  });

  // Permanent failures
  it.each([
    ['RESUME_ATTEMPT_FAILED', 'Codex session state not found'],
    ['TASK_RESUMED_HARD_ERROR', 'Process exited with exit code: 1'],
    ['UNKNOWN_FAILURE', 'Task failed without error details'],
    ['some_new_error', 'Unexpected error'],
  ])('returns "fail" for permanent error code "%s"', (code, message) => {
    expect(classifyFailure(code, message)).toBe('fail' satisfies FailureVerdict);
  });

  // Edge: TASK_RESUMED_HARD_ERROR with exit 1 AND 429 should be rate limit, not permanent
  it('prioritizes 429 over exit code 1 in TASK_RESUMED_HARD_ERROR', () => {
    expect(classifyFailure('TASK_RESUMED_HARD_ERROR', 'exit code: 1 after 429 rate limit'))
      .toBe('retry_after_cooloff' satisfies FailureVerdict);
  });

  // Edge: TASK_RESUMED_HARD_ERROR with both exit 137 and 429 should be retry (137 checked first)
  it('prioritizes exit 137 over 429 in TASK_RESUMED_HARD_ERROR', () => {
    expect(classifyFailure('TASK_RESUMED_HARD_ERROR', 'exit code: 137 after 429'))
      .toBe('retry' satisfies FailureVerdict);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts`
Expected: FAIL with "Cannot find module '../classifyFailure.js'"

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Pure failure classifier for task completion errors.
 *
 * Determines whether a task failure is retryable, needs cooloff,
 * should be triaged by Gemini, or is permanent.
 *
 * This classifies TASK COMPLETION failures (worker ran but failed).
 * Distinct from retryableErrors.ts which classifies DISPATCH failures.
 *
 * INT-1158: Self-healing failure triage.
 */

export type FailureVerdict = 'retry' | 'retry_after_cooloff' | 'ask_gemini' | 'fail';

/** Infrastructure error codes that always indicate transient failures. */
const INFRA_RETRY_CODES = new Set([
  'SETUP_FAILED',
  'dispatch_failed',
  'queue_timeout',
  'queue_full',
  'worker_unavailable',
  'network_error',
]);

export function classifyFailure(errorCode: string, errorMessage: string): FailureVerdict {
  // Infrastructure — always retry
  if (INFRA_RETRY_CODES.has(errorCode)) {
    return 'retry';
  }

  // Container crash — retry if signal kill (OOM/SIGKILL = exit 137)
  if (errorCode === 'TASK_RESUMED_HARD_ERROR' || errorCode === 'TASK_FATAL_EXIT_CODE') {
    if (errorMessage.includes('137')) {
      return 'retry';
    }
    // Rate limit — retry after cooloff (check AFTER 137 so 137+429 = retry)
    if (errorMessage.includes('429')) {
      return 'retry_after_cooloff';
    }
  }

  if (errorCode === 'TASK_COMPLETION_VERIFICATION_FAILED' && errorMessage.includes('fatal_exit_code_137')) {
    return 'retry';
  }

  // Container stopped/Docker issues — retry
  if (errorCode === 'RESUME_ATTEMPT_FAILED') {
    if (errorMessage.includes('409') || errorMessage.includes('timed out')) {
      return 'retry';
    }
  }

  // AI quality failures — ask Gemini
  if (errorCode.endsWith('_ENFORCEMENT_FAILED')) {
    return 'ask_gemini';
  }

  // Everything else — permanent failure
  return 'fail';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/utils/classifyFailure.ts apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts
git commit -m "feat(code-agent): add failure classifier for auto-retry triage (INT-1158)"
```

---

## Task 2: Add `failedWorkerLocation` to CodeTask model and DispatchRequest

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts:254` (before closing brace)
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts:80` (add to DispatchRequest)
- Test: No new test file — types are compile-time checked

- [ ] **Step 1: Add `failedWorkerLocation` and `autoRetryAttempt` to CodeTask**

In `apps/code-agent/src/domain/models/codeTask.ts`, add before the closing `}` of `CodeTask` (after line 254):

```typescript
  // Auto-retry metadata (INT-1158)
  failedWorkerLocation?: string;   // Worker location that failed, to exclude on retry dispatch
  autoRetryAttempt?: number;       // 1-based auto-retry attempt number (max 3)
```

- [ ] **Step 2: Add `failedWorkerLocation` to DispatchRequest**

In `apps/code-agent/src/domain/services/taskDispatcher.ts`, add after `reviewTypes?: string[]` (line 80):

```typescript
  /** Worker location to exclude from dispatch (auto-retry avoidance). INT-1158 */
  failedWorkerLocation?: string;
```

- [ ] **Step 3: Add `failedWorkerLocation` and `autoRetryAttempt` to `CreateTaskInput`**

In `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`, add to `CreateTaskInput` (after `executionMemoryPostRun`):

```typescript
  // Auto-retry metadata (INT-1158)
  failedWorkerLocation?: string;
  autoRetryAttempt?: number;
```

- [ ] **Step 4: Add `failedWorkerLocation` and `autoRetryAttempt` to Firestore serialization**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, update the `create()` method's Firestore document construction to include:

```typescript
  ...(input.failedWorkerLocation !== undefined && { failedWorkerLocation: input.failedWorkerLocation }),
  ...(input.autoRetryAttempt !== undefined && { autoRetryAttempt: input.autoRetryAttempt }),
```

And update the `fromFirestore()` deserialization to read these fields back into the `CodeTask` model:

```typescript
  failedWorkerLocation: data.failedWorkerLocation as string | undefined,
  autoRetryAttempt: data.autoRetryAttempt as number | undefined,
```

- [ ] **Step 5: Verify types compile**

Run: `cd /repo && pnpm --filter code-agent build`
Expected: Build succeeds with no type errors

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts apps/code-agent/src/domain/services/taskDispatcher.ts apps/code-agent/src/domain/repositories/codeTaskRepository.ts apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts
git commit -m "feat(code-agent): add failedWorkerLocation to CodeTask, DispatchRequest, and repository contract (INT-1158)"
```

---

## Task 3: Dispatcher excludes failed worker location

**Files:**
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts:178-186`
- Test: `apps/code-agent/src/__tests__/infra/services/taskDispatcherImpl.test.ts` (add new describe block)

- [ ] **Step 1: Write the failing test**

Add to the existing test file (or create if missing). The test verifies the dispatcher skips the failed worker when alternatives exist, and falls back to the failed worker when it's the only one:

```typescript
describe('failedWorkerLocation filtering', () => {
  it('excludes the failed worker when alternatives exist', async () => {
    // Setup: two workers, worker-a is the failed location
    const request = buildDispatchRequest({
      failedWorkerLocation: 'worker-a',
      workerCredentials: {
        workers: [
          { name: 'worker-a', url: 'https://a.test', cfAccessClientId: 'a', cfAccessClientSecret: 'a', dispatchSigningSecret: 'a' },
          { name: 'worker-b', url: 'https://b.test', cfAccessClientId: 'b', cfAccessClientSecret: 'b', dispatchSigningSecret: 'b' },
        ],
      },
    });
    // Both workers healthy
    fakeHealthProbe.setResults({
      'worker-a': { _tag: 'healthy', available: 5 },
      'worker-b': { _tag: 'healthy', available: 3 },
    });
    fakeWorkerServer.setAccept(true);

    const result = await dispatcher.dispatch(request);

    expect(result.ok).toBe(true);
    // Should dispatch to worker-b, not worker-a
    expect(result.ok && result.value.workerLocation).toBe('worker-b');
  });

  it('falls back to failed worker when it is the only healthy option', async () => {
    const request = buildDispatchRequest({
      failedWorkerLocation: 'worker-a',
      workerCredentials: {
        workers: [
          { name: 'worker-a', url: 'https://a.test', cfAccessClientId: 'a', cfAccessClientSecret: 'a', dispatchSigningSecret: 'a' },
        ],
      },
    });
    fakeHealthProbe.setResults({
      'worker-a': { _tag: 'healthy', available: 5 },
    });
    fakeWorkerServer.setAccept(true);

    const result = await dispatcher.dispatch(request);

    expect(result.ok).toBe(true);
    // Should fall back to worker-a since it's the only option
    expect(result.ok && result.value.workerLocation).toBe('worker-a');
  });

  it('dispatches normally when failedWorkerLocation is undefined', async () => {
    const request = buildDispatchRequest({
      workerCredentials: {
        workers: [
          { name: 'worker-a', url: 'https://a.test', cfAccessClientId: 'a', cfAccessClientSecret: 'a', dispatchSigningSecret: 'a' },
        ],
      },
    });
    fakeHealthProbe.setResults({
      'worker-a': { _tag: 'healthy', available: 5 },
    });
    fakeWorkerServer.setAccept(true);

    const result = await dispatcher.dispatch(request);

    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/services/taskDispatcherImpl.test.ts -t "failedWorkerLocation"`
Expected: FAIL — dispatcher doesn't filter yet

- [ ] **Step 3: Implement the filtering in taskDispatcherImpl.ts**

In `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`, replace the health probe filtering loop (lines 178-186):

```typescript
    // Filter to healthy workers and extract available capacity in a single pass.
    // If failedWorkerLocation is set, prefer workers OTHER than the failed one.
    // Fall back to the failed worker only when no alternatives exist (transient failures often self-resolve).
    const workersWithCapacity: { worker: WorkerConfigWithCredentials; available: number }[] = [];
    const failedWorkerFallback: { worker: WorkerConfigWithCredentials; available: number }[] = [];

    for (const w of workers) {
      const health = healthResults[w.name];
      if (health?._tag === 'healthy') {
        const entry = { worker: w, available: health.available };
        if (request.failedWorkerLocation !== undefined && w.name === request.failedWorkerLocation) {
          failedWorkerFallback.push(entry);
        } else {
          workersWithCapacity.push(entry);
        }
      }
    }

    // Fall back to the failed worker if no alternatives are healthy
    if (workersWithCapacity.length === 0) {
      workersWithCapacity.push(...failedWorkerFallback);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/services/taskDispatcherImpl.test.ts -t "failedWorkerLocation"`
Expected: All tests PASS

- [ ] **Step 5: Run full dispatcher test suite**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/services/taskDispatcherImpl.test.ts`
Expected: All existing tests still PASS (no regression)

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/infra/services/taskDispatcherImpl.ts apps/code-agent/src/__tests__/infra/services/taskDispatcherImpl.test.ts
git commit -m "feat(code-agent): dispatcher excludes failedWorkerLocation on retry (INT-1158)"
```

---

## Task 4: Thread `failedWorkerLocation` through drainTaskQueue dispatch

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:435-462`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

Add a test that verifies when a queued task has `failedWorkerLocation` set, it's passed through to the dispatch request:

```typescript
it('passes failedWorkerLocation through to dispatcher when set on task', async () => {
  // Create a queued task with failedWorkerLocation
  await createQueuedTask({
    id: 'task_retry-1',
    failedWorkerLocation: 'mac-dev-1',
  });

  const result = await drainTaskQueue(deps);

  expect(result.ok).toBe(true);
  // Verify dispatcher received failedWorkerLocation
  expect(fakeDispatcher.lastRequest?.failedWorkerLocation).toBe('mac-dev-1');
});

it('omits failedWorkerLocation from dispatch when not set on task', async () => {
  await createQueuedTask({ id: 'task_normal-1' });

  const result = await drainTaskQueue(deps);

  expect(result.ok).toBe(true);
  expect(fakeDispatcher.lastRequest?.failedWorkerLocation).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts -t "failedWorkerLocation"`
Expected: FAIL — `failedWorkerLocation` not passed through

- [ ] **Step 3: Add failedWorkerLocation to the dispatch call**

In `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`, in the `taskDispatcher.dispatch()` call (around line 435-462), add after the `prNumber` spread:

```typescript
      ...(task.failedWorkerLocation !== undefined && { failedWorkerLocation: task.failedWorkerLocation }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/drainTaskQueue.ts apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts
git commit -m "feat(code-agent): thread failedWorkerLocation through drainTaskQueue (INT-1158)"
```

---

## Task 5: Auto-retry use case (system-initiated retry with budget)

**Files:**
- Create: `apps/code-agent/src/domain/usecases/autoRetryTask.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/autoRetryTask.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { autoRetryTask, type AutoRetryTaskDeps, type AutoRetryTaskRequest } from '../autoRetryTask.js';
import { setServices, resetServices } from '../../../services.js';
// Use existing fakes from the test infrastructure

describe('autoRetryTask', () => {
  let deps: AutoRetryTaskDeps;

  beforeEach(() => {
    // Setup fakes for codeTaskRepo, taskEnqueueService, whatsappNotifier
    deps = buildAutoRetryDeps();
  });

  afterEach(() => {
    resetServices();
  });

  describe('retry budget', () => {
    it('creates retry task when no previous retries exist (attempt 1)', async () => {
      const failedTask = buildFailedTask({ id: 'task_original', retriedFrom: undefined });
      fakeCodeTaskRepo.setTask(failedTask);

      const result = await autoRetryTask(deps, {
        failedTask,
        failedWorkerLocation: 'mac-dev-1',
        reason: 'SETUP_FAILED: Docker tmpfs mount failed',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.autoRetryAttempt).toBe(1);
        expect(result.value.failedWorkerLocation).toBe('mac-dev-1');
      }
    });

    it('walks retriedFrom chain to count depth', async () => {
      // Chain: task_3 -> task_2 -> task_1 (depth 2, under budget)
      const task1 = buildFailedTask({ id: 'task_1', retriedFrom: undefined, status: 'archived' });
      const task2 = buildFailedTask({ id: 'task_2', retriedFrom: 'task_1', status: 'archived' });
      const task3 = buildFailedTask({ id: 'task_3', retriedFrom: 'task_2' });
      fakeCodeTaskRepo.setTasks([task1, task2, task3]);

      const result = await autoRetryTask(deps, {
        failedTask: task3,
        failedWorkerLocation: 'mac-dev-1',
        reason: 'Container OOM',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.autoRetryAttempt).toBe(3);
      }
    });

    it('rejects when retry budget exhausted (depth >= 3)', async () => {
      // Chain: task_4 -> task_3 -> task_2 -> task_1 (depth 3, at budget)
      const task1 = buildFailedTask({ id: 'task_1', retriedFrom: undefined, status: 'archived' });
      const task2 = buildFailedTask({ id: 'task_2', retriedFrom: 'task_1', status: 'archived' });
      const task3 = buildFailedTask({ id: 'task_3', retriedFrom: 'task_2', status: 'archived' });
      const task4 = buildFailedTask({ id: 'task_4', retriedFrom: 'task_3' });
      fakeCodeTaskRepo.setTasks([task1, task2, task3, task4]);

      const result = await autoRetryTask(deps, {
        failedTask: task4,
        failedWorkerLocation: 'mac-dev-1',
        reason: 'Container OOM',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('budget_exhausted');
      }
    });
  });

  describe('task creation', () => {
    it('creates new task with failedWorkerLocation and autoRetryAttempt', async () => {
      const failedTask = buildFailedTask({ id: 'task_original' });
      fakeCodeTaskRepo.setTask(failedTask);

      const result = await autoRetryTask(deps, {
        failedTask,
        failedWorkerLocation: 'mac-dev-1',
        reason: 'SETUP_FAILED',
      });

      expect(result.ok).toBe(true);
      const createdTask = fakeCodeTaskRepo.getLastCreated();
      expect(createdTask?.retriedFrom).toBe('task_original');
      expect(createdTask?.failedWorkerLocation).toBe('mac-dev-1');
      expect(createdTask?.autoRetryAttempt).toBe(1);
      expect(createdTask?.workerLocation).toBe('queued');
    });

    it('enqueues the retry task for dispatch', async () => {
      const failedTask = buildFailedTask({ id: 'task_original' });
      fakeCodeTaskRepo.setTask(failedTask);

      const result = await autoRetryTask(deps, {
        failedTask,
        failedWorkerLocation: 'mac-dev-1',
        reason: 'network_error',
      });

      expect(result.ok).toBe(true);
      expect(fakeEnqueueService.lastEnqueued?.taskId).toBeDefined();
    });

    it('archives the failed task after creating retry', async () => {
      const failedTask = buildFailedTask({ id: 'task_original' });
      fakeCodeTaskRepo.setTask(failedTask);

      await autoRetryTask(deps, {
        failedTask,
        failedWorkerLocation: 'mac-dev-1',
        reason: 'SETUP_FAILED',
      });

      const archived = fakeCodeTaskRepo.getUpdated('task_original');
      expect(archived?.status).toBe('archived');
    });
  });

  describe('whatsapp notification', () => {
    it('sends auto-retry notification with attempt number and reason', async () => {
      const failedTask = buildFailedTask({ id: 'task_original' });
      fakeCodeTaskRepo.setTask(failedTask);

      await autoRetryTask(deps, {
        failedTask,
        failedWorkerLocation: 'mac-dev-1',
        reason: 'Docker tmpfs mount failed',
      });

      expect(fakeWhatsappNotifier.lastAutoRetry).toMatchObject({
        userId: failedTask.userId,
        attempt: 1,
        maxAttempts: 3,
        reason: 'Docker tmpfs mount failed',
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/autoRetryTask.test.ts`
Expected: FAIL with "Cannot find module '../autoRetryTask.js'"

- [ ] **Step 3: Implement autoRetryTask use case**

```typescript
/**
 * Use case: System-initiated auto-retry of a failed code task.
 *
 * Unlike retryTask (user-initiated), this is triggered automatically by
 * the failure triage system. It has:
 * - No user ownership validation (system-initiated)
 * - No cool-off period (except for rate-limit errors, handled by caller)
 * - Retry budget check via retriedFrom chain walking
 * - failedWorkerLocation to exclude on next dispatch
 *
 * INT-1158: Self-healing failure triage.
 */

import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import { randomUUID } from 'node:crypto';
import { sanitizePrompt } from '../utils/promptSanitization.js';
import { generateWebhookSecret } from '../../infra/utils/secrets.js';
import { resolveTaskAgentType } from '../utils/taskRouting.js';

const MAX_AUTO_RETRY_DEPTH = 3;

export interface AutoRetryTaskRequest {
  failedTask: CodeTask;
  failedWorkerLocation: string;
  reason: string;
}

export interface AutoRetryTaskResult {
  codeTaskId: string;
  autoRetryAttempt: number;
  failedWorkerLocation: string;
}

export type AutoRetryTaskErrorCode = 'budget_exhausted' | 'internal_error';

export interface AutoRetryTaskError {
  code: AutoRetryTaskErrorCode;
  message: string;
}

export interface AutoRetryTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskEnqueueService: TaskEnqueueService;
  whatsappNotifier: WhatsAppNotifier;
  orchestratorSecret: string;
}

/**
 * Count auto-retry depth by walking the retriedFrom chain.
 * Each hop increments depth by 1. Stops at MAX_AUTO_RETRY_DEPTH or chain end.
 */
async function countRetryDepth(
  codeTaskRepo: CodeTaskRepository,
  task: CodeTask
): Promise<number> {
  let depth = 0;
  let currentRetryFrom = task.retriedFrom;

  while (currentRetryFrom !== undefined && depth < MAX_AUTO_RETRY_DEPTH) {
    depth++;
    const parentResult = await codeTaskRepo.findById(currentRetryFrom);
    if (!parentResult.ok || parentResult.value === null) {
      break;
    }
    currentRetryFrom = parentResult.value.retriedFrom;
  }

  return depth;
}

export async function autoRetryTask(
  deps: AutoRetryTaskDeps,
  request: AutoRetryTaskRequest
): Promise<Result<AutoRetryTaskResult, AutoRetryTaskError>> {
  const { logger, codeTaskRepo, taskEnqueueService, whatsappNotifier, orchestratorSecret } = deps;
  const { failedTask, failedWorkerLocation, reason } = request;

  // Step 1: Check retry budget via chain walking
  const retryDepth = await countRetryDepth(codeTaskRepo, failedTask);
  const attemptNumber = retryDepth + 1;

  if (attemptNumber > MAX_AUTO_RETRY_DEPTH) {
    logger.info(
      { taskId: failedTask.id, retryDepth, maxDepth: MAX_AUTO_RETRY_DEPTH },
      'Auto-retry budget exhausted'
    );
    return err({
      code: 'budget_exhausted',
      message: `Auto-retry budget exhausted after ${String(retryDepth)} attempts`,
    });
  }

  // Step 2: Create new retry task
  const retryTaskId = `task_${randomUUID()}`;
  const webhookSecret = generateWebhookSecret(orchestratorSecret, retryTaskId);

  const createResult = await codeTaskRepo.create({
    id: retryTaskId,
    userId: failedTask.userId,
    prompt: failedTask.prompt,
    sanitizedPrompt: failedTask.sanitizedPrompt,
    systemPromptHash: failedTask.systemPromptHash,
    workerType: failedTask.workerType,
    workerLocation: 'queued',
    repository: failedTask.repository,
    baseBranch: failedTask.baseBranch,
    traceId: `auto-retry-${String(Date.now())}`,
    webhookSecret,
    retriedFrom: failedTask.id,
    failedWorkerLocation,
    autoRetryAttempt: attemptNumber,
    agentType: failedTask.agentType,
    ...(failedTask.linearIssueId !== undefined && { linearIssueId: failedTask.linearIssueId }),
    ...(failedTask.prNumber !== undefined && { prNumber: failedTask.prNumber }),
    ...(failedTask.prBranch !== undefined && { prBranch: failedTask.prBranch }),
  });

  if (!createResult.ok) {
    logger.error({ error: createResult.error, failedTaskId: failedTask.id }, 'Failed to create auto-retry task');
    return err({ code: 'internal_error', message: `Failed to create auto-retry task: ${createResult.error.message}` });
  }

  // Step 3: Enqueue for dispatch
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: retryTaskId,
    userId: failedTask.userId,
  });

  if (!enqueueResult.ok) {
    logger.error({ error: enqueueResult.error, retryTaskId }, 'Failed to enqueue auto-retry task');
    return err({ code: 'internal_error', message: enqueueResult.error.message });
  }

  // Step 4: Preserve terminal failure record, then archive the failed task
  // The webhook handler normally writes completedAt, error, callbackReceived, status, and metrics
  // on the original task before any early return. For auto-retried tasks we must preserve these
  // terminal failure fields so the original task's failure is fully recorded before archiving.
  // The caller (triageFailedTask / webhook handler) is responsible for writing the standard
  // failure fields (completedAt, error, callbackReceived, status='failed') BEFORE calling
  // autoRetryTask. This function only transitions the already-recorded failed task to 'archived'.
  const archiveResult = await codeTaskRepo.update(failedTask.id, { status: 'archived' });
  if (!archiveResult.ok) {
    logger.warn(
      { failedTaskId: failedTask.id, retryTaskId, error: archiveResult.error },
      'Failed to archive failed task after auto-retry (non-fatal)'
    );
  }

  // Step 5: Send WhatsApp notification
  await whatsappNotifier.notifyTaskAutoRetried(
    failedTask.userId,
    failedTask,
    { attempt: attemptNumber, maxAttempts: MAX_AUTO_RETRY_DEPTH, reason }
  );

  logger.info(
    { failedTaskId: failedTask.id, retryTaskId, attempt: attemptNumber, failedWorkerLocation, reason },
    'Auto-retry task created'
  );

  return ok({ codeTaskId: retryTaskId, autoRetryAttempt: attemptNumber, failedWorkerLocation });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/autoRetryTask.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/autoRetryTask.ts apps/code-agent/src/__tests__/domain/usecases/autoRetryTask.test.ts
git commit -m "feat(code-agent): auto-retry use case with budget and chain walking (INT-1158)"
```

---

## Task 6: WhatsApp auto-retry notification

**Files:**
- Modify: `apps/code-agent/src/domain/services/whatsappNotifier.ts` (add interface method)
- Modify: `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` (implement)
- Test: `apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts` (add tests)

- [ ] **Step 1: Write the failing test**

```typescript
describe('notifyTaskAutoRetried', () => {
  it('sends auto-retry message with attempt count and reason', async () => {
    const task = buildTask({ linearIssueId: 'INT-500' });
    const result = await notifier.notifyTaskAutoRetried(
      'user-1',
      task,
      { attempt: 2, maxAttempts: 3, reason: 'Docker tmpfs mount failed' }
    );

    expect(result.ok).toBe(true);
    const published = fakeWhatsappPublisher.lastPublished;
    expect(published?.message).toContain('Auto-retried');
    expect(published?.message).toContain('2/3');
    expect(published?.message).toContain('Docker tmpfs mount failed');
  });

  it('sends exhausted message when flagged', async () => {
    const task = buildTask({ linearIssueId: 'INT-500' });
    const result = await notifier.notifyTaskAutoRetryExhausted(
      'user-1',
      task,
      { attempts: 3, errorMessage: 'Container OOM killed' }
    );

    expect(result.ok).toBe(true);
    const published = fakeWhatsappPublisher.lastPublished;
    expect(published?.message).toContain('failed after 3 auto-retries');
    expect(published?.message).toContain('Container OOM killed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts -t "notifyTaskAutoRetried"`
Expected: FAIL — method doesn't exist

- [ ] **Step 3: Add methods to WhatsAppNotifier interface**

In `apps/code-agent/src/domain/services/whatsappNotifier.ts`, add before the closing `}`:

```typescript
  /**
   * Send notification when a task is auto-retried by the failure triage system.
   * INT-1158
   *
   * @param userId - User ID to send notification to
   * @param task - The failed task being retried
   * @param info - Retry attempt details
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyTaskAutoRetried(
    userId: string,
    task: CodeTask,
    info: { attempt: number; maxAttempts: number; reason: string }
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when auto-retry budget is exhausted.
   * INT-1158
   *
   * @param userId - User ID to send notification to
   * @param task - The task that exhausted its retry budget
   * @param info - Failure details
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyTaskAutoRetryExhausted(
    userId: string,
    task: CodeTask,
    info: { attempts: number; errorMessage: string }
  ): Promise<Result<void, NotificationError>>;
```

- [ ] **Step 4: Implement in whatsappNotifierImpl.ts**

Add two methods to the implementation class:

```typescript
  async notifyTaskAutoRetried(
    userId: string,
    task: CodeTask,
    info: { attempt: number; maxAttempts: number; reason: string }
  ): Promise<Result<void, NotificationError>> {
    const linearPrefix = task.linearIssueId !== undefined ? `${task.linearIssueId} | ` : '';
    const message = `\u27F3 ${linearPrefix}Auto-retried (${String(info.attempt)}/${String(info.maxAttempts)}): ${info.reason}`;

    return this.publishMessage(userId, message, task);
  }

  async notifyTaskAutoRetryExhausted(
    userId: string,
    task: CodeTask,
    info: { attempts: number; errorMessage: string }
  ): Promise<Result<void, NotificationError>> {
    const linearPrefix = task.linearIssueId !== undefined ? `${task.linearIssueId} | ` : '';
    const message = `\u274C ${linearPrefix}Task failed after ${String(info.attempts)} auto-retries: ${info.errorMessage}`;

    return this.publishMessage(userId, message, task);
  }
```

Note: Extract common publish logic into a `publishMessage` helper if not already present, or inline the existing `whatsappPublisher.publishSendMessage` call pattern.

- [ ] **Step 5: Update existing WhatsApp mock factories**

Adding `notifyTaskAutoRetried` and `notifyTaskAutoRetryExhausted` to the `WhatsAppNotifier` interface will break existing typed mocks across multiple test files. Update each mock factory to include stubs for the new methods:

**Files requiring mock updates:**
- `apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts` — `createMockWhatsAppNotifier()` factory (line ~160)
- `apps/code-agent/src/__tests__/usecases/submitTaskFeedback.test.ts` — inline `mockWhatsAppNotifier` object (line ~106)
- `apps/code-agent/src/__tests__/domain/usecases/sendTaskMessage.test.ts` — `mockWhatsappNotifier` (line ~136)
- Any other test file with a typed `WhatsAppNotifier` mock (search: `WhatsAppNotifier` in test files)

For each mock, add:
```typescript
notifyTaskAutoRetried: vi.fn().mockResolvedValue(ok(undefined)),
notifyTaskAutoRetryExhausted: vi.fn().mockResolvedValue(ok(undefined)),
```

Run all affected test suites to confirm no type errors:
```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts apps/code-agent/src/__tests__/usecases/submitTaskFeedback.test.ts apps/code-agent/src/__tests__/domain/usecases/sendTaskMessage.test.ts
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/services/whatsappNotifier.ts apps/code-agent/src/infra/services/whatsappNotifierImpl.ts apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts apps/code-agent/src/__tests__/usecases/submitTaskFeedback.test.ts apps/code-agent/src/__tests__/domain/usecases/sendTaskMessage.test.ts
git commit -m "feat(code-agent): WhatsApp notifications for auto-retry (INT-1158)"
```

---

## Task 7: Gemini failure triage prompt

**Files:**
- Create: `apps/code-agent/src/domain/prompts/failureTriagePrompt.ts`
- Test: `apps/code-agent/src/__tests__/domain/prompts/failureTriagePrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { buildFailureTriagePrompt, parseTriageResponse, FAILURE_TRIAGE_PROMPT_VERSION } from '../../../domain/prompts/failureTriagePrompt.js';

describe('buildFailureTriagePrompt', () => {
  it('includes error code in prompt', () => {
    const prompt = buildFailureTriagePrompt({
      errorCode: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
      errorMessage: 'Missing required output fields',
      recentLogLines: ['line 1', 'line 2'],
    });

    expect(prompt).toContain('EXECUTION_AGENT_ENFORCEMENT_FAILED');
    expect(prompt).toContain('Missing required output fields');
    expect(prompt).toContain('line 1');
  });

  it('limits log lines to 20', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${String(i)}`);
    const prompt = buildFailureTriagePrompt({
      errorCode: 'TEST_ENFORCEMENT_FAILED',
      errorMessage: 'test',
      recentLogLines: lines,
    });

    // Should only include the LAST 20 lines
    expect(prompt).not.toContain('line 0');
    expect(prompt).toContain('line 10');
    expect(prompt).toContain('line 29');
  });

  it('has a version field', () => {
    expect(FAILURE_TRIAGE_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('parseTriageResponse', () => {
  it('parses valid JSON response with shouldRetry true', () => {
    const result = parseTriageResponse('{"shouldRetry": true, "reason": "Transient formatting error"}');
    expect(result).toEqual({ shouldRetry: true, reason: 'Transient formatting error' });
  });

  it('parses valid JSON response with shouldRetry false', () => {
    const result = parseTriageResponse('{"shouldRetry": false, "reason": "Logic error in output"}');
    expect(result).toEqual({ shouldRetry: false, reason: 'Logic error in output' });
  });

  it('extracts JSON from markdown code block', () => {
    const result = parseTriageResponse('```json\n{"shouldRetry": true, "reason": "test"}\n```');
    expect(result).toEqual({ shouldRetry: true, reason: 'test' });
  });

  it('returns shouldRetry false on parse failure', () => {
    const result = parseTriageResponse('This is not JSON');
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('parse');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/prompts/failureTriagePrompt.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the prompt builder**

```typescript
/**
 * Gemini prompt for triaging *_ENFORCEMENT_FAILED errors.
 *
 * A single Gemini call (not an agent with tools) that reads the error
 * context and recent log lines to decide if retrying would help.
 *
 * INT-1158: Self-healing failure triage.
 */

export const FAILURE_TRIAGE_PROMPT_VERSION = '1.0.0';

const MAX_LOG_LINES = 20;

export interface TriagePromptInput {
  errorCode: string;
  errorMessage: string;
  recentLogLines: string[];
}

export interface TriageResponse {
  shouldRetry: boolean;
  reason: string;
}

export function buildFailureTriagePrompt(input: TriagePromptInput): string {
  const logLines = input.recentLogLines.slice(-MAX_LOG_LINES);
  const logSection = logLines.length > 0
    ? logLines.join('\n')
    : '(no log lines available)';

  return `You are a failure triage system for automated code tasks. A task failed with an enforcement error, meaning the AI agent did not produce the required output format.

## Error Details
- **Error Code:** ${input.errorCode}
- **Error Message:** ${input.errorMessage}

## Recent Log Lines (last ${String(logLines.length)}):
\`\`\`
${logSection}
\`\`\`

## Your Task
Analyze whether this failure is likely transient (retrying with a fresh context would succeed) or permanent (a systematic issue that will fail again).

Transient indicators: the agent was close to completing, hit a context limit, made a formatting mistake, or had a timing issue.
Permanent indicators: the task is fundamentally impossible, the requirements contradict each other, or there's a systematic misunderstanding.

Respond with ONLY a JSON object:
\`\`\`json
{"shouldRetry": true/false, "reason": "brief explanation"}
\`\`\``;
}

export function parseTriageResponse(rawResponse: string): TriageResponse {
  try {
    // Handle markdown code block wrapping
    const jsonMatch = rawResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch !== null ? jsonMatch[1] ?? rawResponse : rawResponse;

    const parsed: unknown = JSON.parse(jsonStr.trim());

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'shouldRetry' in parsed &&
      typeof (parsed as Record<string, unknown>).shouldRetry === 'boolean' &&
      'reason' in parsed &&
      typeof (parsed as Record<string, unknown>).reason === 'string'
    ) {
      return {
        shouldRetry: (parsed as { shouldRetry: boolean }).shouldRetry,
        reason: (parsed as { shouldRetry: boolean; reason: string }).reason,
      };
    }

    return { shouldRetry: false, reason: `Unexpected response structure: ${jsonStr.trim().slice(0, 100)}` };
  } catch {
    return { shouldRetry: false, reason: `Failed to parse triage response: ${rawResponse.slice(0, 100)}` };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/prompts/failureTriagePrompt.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/prompts/failureTriagePrompt.ts apps/code-agent/src/__tests__/domain/prompts/failureTriagePrompt.test.ts
git commit -m "feat(code-agent): Gemini failure triage prompt for enforcement errors (INT-1158)"
```

---

## Task 8: Triage failed task orchestrator use case

**Files:**
- Create: `apps/code-agent/src/domain/usecases/triageFailedTask.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/triageFailedTask.test.ts`

This is the main orchestrator that wires together classifier + budget + Gemini + auto-retry.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { triageFailedTask, type TriageFailedTaskDeps } from '../../../domain/usecases/triageFailedTask.js';

describe('triageFailedTask', () => {
  let deps: TriageFailedTaskDeps;

  beforeEach(() => {
    deps = buildTriageDeps();
  });

  afterEach(() => {
    resetServices();
  });

  describe('retry verdict', () => {
    it('auto-retries infrastructure failures immediately', async () => {
      const task = buildFailedTask({
        error: { code: 'SETUP_FAILED', message: 'Docker tmpfs mount failed' },
        workerLocation: 'mac-dev-1',
      });

      const result = await triageFailedTask(deps, { task, completedAt: new Date() });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('retried');
      }
    });
  });

  describe('retry_after_cooloff verdict', () => {
    it('auto-retries rate-limit failures (caller schedules delay)', async () => {
      const task = buildFailedTask({
        error: { code: 'TASK_RESUMED_HARD_ERROR', message: 'API returned 429 Too Many Requests' },
        workerLocation: 'mac-dev-1',
      });

      const result = await triageFailedTask(deps, { task, completedAt: new Date() });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('retried_after_cooloff');
      }
    });
  });

  describe('ask_gemini verdict', () => {
    it('calls Gemini for enforcement failures and retries if shouldRetry', async () => {
      const task = buildFailedTask({
        error: { code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED', message: 'Missing fields' },
        workerLocation: 'mac-dev-1',
      });
      fakeGeminiClient.setResponse({ shouldRetry: true, reason: 'Transient formatting issue' });

      const result = await triageFailedTask(deps, { task, completedAt: new Date() });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('retried');
      }
      expect(fakeLogLineRepo.lastListRecentCall).toEqual({ taskId: task.id, limit: 20 });
    });

    it('falls through to permanent failure when Gemini says no', async () => {
      const task = buildFailedTask({
        error: { code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED', message: 'Logic error' },
        workerLocation: 'mac-dev-1',
      });
      fakeGeminiClient.setResponse({ shouldRetry: false, reason: 'Systematic misunderstanding' });

      const result = await triageFailedTask(deps, { task, completedAt: new Date() });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('permanent_failure');
      }
    });

    it('falls through to permanent failure when Gemini call fails', async () => {
      const task = buildFailedTask({
        error: { code: 'PLANNING_AGENT_ENFORCEMENT_FAILED', message: 'Plan missing' },
        workerLocation: 'mac-dev-1',
      });
      fakeGeminiClient.setError('LLM call failed');

      const result = await triageFailedTask(deps, { task, completedAt: new Date() });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('permanent_failure');
      }
    });
  });

  describe('fail verdict', () => {
    it('returns permanent_failure for unrecognized errors', async () => {
      const task = buildFailedTask({
        error: { code: 'UNKNOWN_FAILURE', message: 'Something went wrong' },
        workerLocation: 'mac-dev-1',
      });

      const result = await triageFailedTask(deps, { task, completedAt: new Date() });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('permanent_failure');
      }
    });
  });

  describe('budget exhaustion', () => {
    it('returns permanent_failure with exhausted reason when budget exceeded', async () => {
      const task = buildFailedTask({
        error: { code: 'SETUP_FAILED', message: 'Docker failed again' },
        workerLocation: 'mac-dev-1',
      });
      // Mock autoRetryTask to return budget_exhausted
      fakeAutoRetry.setError({ code: 'budget_exhausted', message: 'Exhausted after 3 attempts' });

      const result = await triageFailedTask(deps, { task, completedAt: new Date() });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('permanent_failure');
        expect(result.value.reason).toContain('budget');
      }
    });

    it('sends exhausted WhatsApp notification when budget exceeded', async () => {
      const task = buildFailedTask({
        error: { code: 'SETUP_FAILED', message: 'Docker failed' },
        workerLocation: 'mac-dev-1',
      });
      fakeAutoRetry.setError({ code: 'budget_exhausted', message: 'Exhausted after 3 attempts' });

      await triageFailedTask(deps, { task, completedAt: new Date() });

      expect(fakeWhatsappNotifier.lastExhausted).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/triageFailedTask.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement triageFailedTask use case**

```typescript
/**
 * Use case: Triage a failed task for auto-retry.
 *
 * Orchestrates: classify -> budget check -> (optional Gemini) -> auto-retry or permanent fail.
 *
 * INT-1158: Self-healing failure triage.
 */

import { ok, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTask, TaskError } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { classifyFailure } from '../utils/classifyFailure.js';
import { autoRetryTask } from './autoRetryTask.js';
import { buildFailureTriagePrompt, parseTriageResponse } from '../prompts/failureTriagePrompt.js';

export type TriageAction = 'retried' | 'retried_after_cooloff' | 'permanent_failure';

export interface TriageResult {
  action: TriageAction;
  reason: string;
  retryTaskId?: string;
}

export interface TriageFailedTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskEnqueueService: TaskEnqueueService;
  whatsappNotifier: WhatsAppNotifier;
  logLineRepo: LogLineRepository;
  triageClient?: LlmGenerateClient;
  orchestratorSecret: string;
}

export async function triageFailedTask(
  deps: TriageFailedTaskDeps,
  request: { task: CodeTask; completedAt: Date }
): Promise<Result<TriageResult, never>> {
  const { logger, codeTaskRepo, taskEnqueueService, whatsappNotifier, logLineRepo, triageClient, orchestratorSecret } = deps;
  const { task } = request;
  const taskError: TaskError = task.error ?? { code: 'UNKNOWN_FAILURE', message: 'Task failed without error details' };

  // Step 1: Classify the failure
  const verdict = classifyFailure(taskError.code, taskError.message);
  logger.info({ taskId: task.id, errorCode: taskError.code, verdict }, 'Failure classified');

  // Step 2: Handle permanent failures immediately
  if (verdict === 'fail') {
    return ok({ action: 'permanent_failure', reason: `Classified as permanent: ${taskError.code}` });
  }

  // Step 3: For ask_gemini, call Gemini to decide
  if (verdict === 'ask_gemini') {
    const geminiDecision = await askGeminiForTriage(deps, task, taskError);
    if (!geminiDecision.shouldRetry) {
      return ok({ action: 'permanent_failure', reason: `Gemini: ${geminiDecision.reason}` });
    }
    // Fall through to retry
  }

  // Step 4: Attempt auto-retry
  const retryResult = await autoRetryTask(
    { logger, codeTaskRepo, taskEnqueueService, whatsappNotifier, orchestratorSecret },
    {
      failedTask: task,
      failedWorkerLocation: task.workerLocation,
      reason: `${taskError.code}: ${taskError.message}`.slice(0, 200),
    }
  );

  if (!retryResult.ok) {
    if (retryResult.error.code === 'budget_exhausted') {
      // Send exhausted notification
      await whatsappNotifier.notifyTaskAutoRetryExhausted(
        task.userId,
        task,
        { attempts: 3, errorMessage: taskError.message }
      );
      return ok({
        action: 'permanent_failure',
        reason: `Auto-retry budget exhausted: ${retryResult.error.message}`,
      });
    }
    // Internal error — fall through to permanent failure
    return ok({ action: 'permanent_failure', reason: `Auto-retry failed: ${retryResult.error.message}` });
  }

  const action: TriageAction = verdict === 'retry_after_cooloff' ? 'retried_after_cooloff' : 'retried';
  return ok({
    action,
    reason: `${taskError.code}: ${taskError.message}`.slice(0, 200),
    retryTaskId: retryResult.value.codeTaskId,
  });
}

async function askGeminiForTriage(
  deps: TriageFailedTaskDeps,
  task: CodeTask,
  taskError: TaskError
): Promise<{ shouldRetry: boolean; reason: string }> {
  const { logger, logLineRepo, triageClient } = deps;

  if (triageClient === undefined) {
    logger.warn({ taskId: task.id }, 'Gemini triage client not configured, defaulting to no-retry');
    return { shouldRetry: false, reason: 'Gemini triage client not configured' };
  }

  // Fetch recent log lines
  const logResult = await logLineRepo.listRecent(task.id, 20);
  const logLines = logResult.ok
    ? logResult.value.map((line) => line.text)
    : [];

  if (!logResult.ok) {
    logger.warn({ taskId: task.id, error: logResult.error }, 'Failed to fetch log lines for triage');
  }

  const prompt = buildFailureTriagePrompt({
    errorCode: taskError.code,
    errorMessage: taskError.message,
    recentLogLines: logLines,
  });

  const generateResult = await triageClient.generate(prompt);
  if (!generateResult.ok) {
    logger.warn({ taskId: task.id, error: generateResult.error }, 'Gemini triage call failed, defaulting to no-retry');
    return { shouldRetry: false, reason: `Gemini call failed: ${generateResult.error.message}` };
  }

  const triageResponse = parseTriageResponse(generateResult.value.content);
  logger.info(
    { taskId: task.id, shouldRetry: triageResponse.shouldRetry, reason: triageResponse.reason },
    'Gemini triage decision'
  );

  return triageResponse;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/triageFailedTask.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/triageFailedTask.ts apps/code-agent/src/__tests__/domain/usecases/triageFailedTask.test.ts
git commit -m "feat(code-agent): triage orchestrator use case with Gemini path (INT-1158)"
```

---

## Task 9: Wire triage into webhook handler

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:1702-1786`
- Modify: `apps/code-agent/src/services.ts` (wire Gemini triage client)
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts` (add triage integration tests)

- [ ] **Step 1: Write the failing tests**

Add to the existing webhook routes test file:

```typescript
describe('task-complete webhook with failure triage', () => {
  it('auto-retries SETUP_FAILED instead of marking permanent failure', async () => {
    const task = await createDispatchedTask({ id: 'task_infra-fail' });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      payload: {
        taskId: 'task_infra-fail',
        status: 'failed',
        error: { code: 'SETUP_FAILED', message: 'Docker tmpfs mount failed' },
      },
      headers: buildWebhookHeaders('task_infra-fail'),
    });

    expect(response.statusCode).toBe(200);
    // Verify a retry task was created
    const retryTask = fakeCodeTaskRepo.findByRetryFrom('task_infra-fail');
    expect(retryTask).toBeDefined();
    expect(retryTask?.failedWorkerLocation).toBe(task.workerLocation);
    // Verify original task was archived
    const original = fakeCodeTaskRepo.getTask('task_infra-fail');
    expect(original?.status).toBe('archived');
  });

  it('falls through to permanent failure for unrecognized errors', async () => {
    await createDispatchedTask({ id: 'task_perm-fail' });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      payload: {
        taskId: 'task_perm-fail',
        status: 'failed',
        error: { code: 'UNKNOWN_ERROR', message: 'Something broke' },
      },
      headers: buildWebhookHeaders('task_perm-fail'),
    });

    expect(response.statusCode).toBe(200);
    // Verify task is marked as permanently failed (not retried)
    const task = fakeCodeTaskRepo.getTask('task_perm-fail');
    expect(task?.status).toBe('failed');
  });

  it('skips triage for PLANNING_AGENT_UNCLEAR (existing special handling)', async () => {
    await createDispatchedTask({ id: 'task_unclear' });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      payload: {
        taskId: 'task_unclear',
        status: 'failed',
        error: { code: 'PLANNING_AGENT_UNCLEAR', message: 'Task was unclear' },
        result: { planning_outcome_label: 'unclear' },
      },
      headers: buildWebhookHeaders('task_unclear'),
    });

    expect(response.statusCode).toBe(200);
    // Should use existing PLANNING_AGENT_UNCLEAR path, not triage
    const task = fakeCodeTaskRepo.getTask('task_unclear');
    expect(task?.status).not.toBe('archived');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks.test.ts -t "failure triage"`
Expected: FAIL — triage not wired yet

- [ ] **Step 3: Wire the Gemini triage client in services.ts**

In `apps/code-agent/src/services.ts`, add alongside other Gemini clients:

```typescript
  const failureTriageClient = config.geminiAppApiKey !== ''
    ? createLlmClient({
        apiKey: config.geminiAppApiKey,
        model: EXECUTION_MEMORY_MODEL,  // Gemini 2.5 Flash — lightweight single call
        userId: 'system:failure-triage',
        pricing: GEMINI_TOOL_CALLING_PRICING,
        logger,
        usageSink: buildUsageSink('failure-triage'),
      })
    : undefined;
```

Expose it via services (e.g., `failureTriageClient` in the ServiceContainer).

- [ ] **Step 4: Insert triage into webhookRoutes.ts failure path**

In `apps/code-agent/src/routes/webhookRoutes.ts`, modify the `status === 'failed'` block. Insert triage AFTER the `PLANNING_AGENT_UNCLEAR` special case but BEFORE the standard failure update.

**Important:** The standard failure fields (`completedAt`, `error`, `callbackReceived`, status='failed', metrics) MUST be recorded on the original task BEFORE calling `triageFailedTask`. This ensures the original task's terminal failure state is fully preserved regardless of whether triage decides to auto-retry. The triage/autoRetryTask flow only transitions the already-recorded failed task to 'archived' — it does NOT write the failure fields itself.

```typescript
      if (status === 'failed') {
        const taskError = error ?? { code: 'UNKNOWN_FAILURE', message: 'Task failed without error details' };

        // Existing: PLANNING_AGENT_UNCLEAR special handling (lines 1704-1727)
        if (taskError.code === 'PLANNING_AGENT_UNCLEAR' && result?.planning_outcome_label === 'unclear') {
          // ... existing code unchanged ...
        }

        // Record standard failure fields on the original task BEFORE triage.
        // This preserves the terminal failure record (completedAt, error, callbackReceived,
        // status, metrics) so autoRetryTask only needs to transition status to 'archived'.
        await codeTaskRepo.update(taskId, {
          status: 'failed',
          completedAt,
          error: taskError,
          callbackReceived: true,
        });

        // NEW: Auto-retry triage (INT-1158)
        // Skip triage for PLANNING_AGENT_UNCLEAR (handled above) to avoid double-processing
        if (taskError.code !== 'PLANNING_AGENT_UNCLEAR') {
          const triageResult = await triageFailedTask(
            {
              logger: request.log,
              codeTaskRepo,
              taskEnqueueService,
              whatsappNotifier,
              logLineRepo,
              triageClient: failureTriageClient,
              orchestratorSecret,
            },
            { task, completedAt }
          );

          if (triageResult.ok && triageResult.value.action !== 'permanent_failure') {
            request.log.info(
              { taskId, action: triageResult.value.action, retryTaskId: triageResult.value.retryTaskId },
              'Task auto-retried by failure triage'
            );
            // For cooloff retries, the delay is handled at task level — drainTaskQueue
            // will pick up the retry task on next scheduler tick (1-minute interval)
            await flushPendingTaskLogLines(taskId);
            await triggerDrainForPR();
            // @allow-raw-send: external webhook callback - orchestrator expects { received: true }
            return await reply.send({ received: true });
          }
          // Fall through to permanent failure path
          if (triageResult.ok && triageResult.value.action === 'permanent_failure') {
            request.log.info(
              { taskId, reason: triageResult.value.reason },
              'Failure triage: permanent failure'
            );
          }
        }

        // ... existing standard failure update code (lines 1728-1785) unchanged ...
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks.test.ts`
Expected: All tests PASS (both new and existing)

- [ ] **Step 6: Run full CI check**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: All tests pass, coverage meets thresholds

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/services.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "feat(code-agent): wire failure triage into task-complete webhook (INT-1158)"
```

---

## Task 10: Final integration verification

- [ ] **Step 1: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: All workspaces pass

- [ ] **Step 2: Verify coverage**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: 100% branch coverage on classifyFailure, autoRetryTask, triageFailedTask

- [ ] **Step 3: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "chore(code-agent): fix coverage and CI for failure triage (INT-1158)"
```

---

## Endpoint Changes

* **Modified:** `POST /internal/webhooks/task-complete` — adds auto-retry triage before permanent failure path
* **Created:** None (no new endpoints)
* **Removed:** None
* **Unchanged:** All other endpoints

## Rate-Limit Cooloff Implementation Note

**Intended behavior:** The `retry_after_cooloff` verdict does NOT enforce a fixed 15-minute delay (the original issue description's "15-minute" note was aspirational). Instead, the retry task is enqueued immediately and dispatched on the next `drainTaskQueue` scheduler tick (~1-minute interval). The failed worker is excluded via `failedWorkerLocation`, so:

- **Multi-worker:** Retry dispatches to an alternate worker immediately (rate limit is per-worker).
- **Single-worker:** Retry attempts on the next scheduler tick; the ~1-minute natural delay is usually sufficient for transient 429s.

The `retry_after_cooloff` verdict exists as a distinct classification (separate from `retry`) so that future enhancements can add a dedicated delay mechanism (e.g., via `drainRetryQueue` TTL) without changing the classifier. The current approach is pragmatic and avoids new infrastructure.
