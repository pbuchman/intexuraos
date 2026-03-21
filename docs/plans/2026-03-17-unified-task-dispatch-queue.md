# Unified Task Dispatch Queue Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all direct-dispatch paths so every task goes through the persistent Firestore queue, and add a real-time Dispatch Queue view in the web UI.

**Architecture:** Introduce a new `TaskEnqueueService` domain service that is the ONLY way usecases submit tasks for execution. It always writes the task to Firestore with `status='queued'` and returns immediately. The existing `drainTaskQueue` Cloud Scheduler job (runs every minute) remains the sole dispatcher. This removes ~200 lines of duplicated dispatch+queue fallback code from 8 call sites (7 usecases + 1 inline route handler).

**Tech Stack:** TypeScript, Fastify, Firestore, React, Firebase SDK (onSnapshot), TailwindCSS, Vitest

---

## Problem Statement

Currently, 8 call sites call `taskDispatcher.dispatch()` directly and duplicate the same ~30-50 line at_capacity-to-queue fallback pattern. Some (like `submitTaskFeedback`) lack queue fallback entirely. Each time a new dispatch path is added, the queue logic must be copy-pasted, leading to inconsistencies and bugs.

### Current Dispatch Call Sites (ALL must be refactored)

| #   | Usecase / Location                        | File                                     | Has Queue Fallback?    |
| --- | ----------------------------------------- | ---------------------------------------- | ---------------------- |
| 1   | `processCodeAction`                       | `usecases/processCodeAction.ts`          | Yes                    |
| 2   | `retryTask`                               | `usecases/retryTask.ts`                  | Yes                    |
| 3   | `createTaskForPR`                         | `usecases/createTaskForPR.ts`            | Yes + dispatch_retries |
| 4   | `createReviewTask`                        | `usecases/createReviewTask.ts`           | Yes                    |
| 5   | `submitToExecutionAgent`                  | `usecases/submitToExecutionAgent.ts`     | Yes (with rollback)    |
| 6   | `detectMergeConflictsOnPush`              | `usecases/detectMergeConflictsOnPush.ts` | Partial (no WhatsApp)  |
| 7   | `submitTaskFeedback`                      | `usecases/submitTaskFeedback.ts`         | **NO** (just fails)    |
| 8   | `POST /code/submit` inline route handler  | `routes/codeRoutes.ts:1250-1498`         | Yes                    |

### What Gets Duplicated in Each Usecase

Each of the 7 usecases repeats this exact pattern after creating a task:
1. Build a `DispatchRequest` object from task fields
2. Call `taskDispatcher.dispatch(dispatchRequest)`
3. If success: update task to `status='dispatched'`, set `cancelNonce`, send WhatsApp notification
4. If `at_capacity`: check queue size, if room leave as queued + notify, if full fail
5. If other error: mark task as failed

This entire block (steps 1-5) is eliminated from all usecases.

---

## Target Architecture

```
BEFORE (7 paths to dispatch):
  usecase1 ──┐
  usecase2 ──┼── taskDispatcher.dispatch() ──→ Worker
  usecase3 ──┤   (each with duplicated queue fallback)
  ...        ┘

AFTER (1 path through queue):
  usecase1 ──┐
  usecase2 ──┼── taskEnqueueService.enqueue() ──→ Firestore (status='queued')
  usecase3 ──┤   (returns immediately)
  ...        ┘
                                                     │
                                                     ▼
                              Cloud Scheduler (every 1 min)
                                                     │
                                                     ▼
                              drainTaskQueue() ──→ taskDispatcher.dispatch() ──→ Worker
```

### Key Design Decisions

1. **Queue-first, always.** No task ever attempts direct dispatch. Every task enters as `status='queued'` and waits for the scheduler.
2. **Max ~1 minute latency.** The Cloud Scheduler runs every minute. This is explicitly acceptable per requirements.
3. **`TaskEnqueueService` is a domain service**, not infrastructure. It encapsulates the queue-size check and Firestore write.
4. **`drainTaskQueue` is the sole dispatcher.** All dispatch logic (worker probing, fallback, error handling, notifications) lives only here.
5. **Store dispatch metadata on task document.** Fields like `planningPrBranch`, `planningPrUrl`, and `trackingCommentId` that are currently only passed at dispatch time must be persisted on the task so `drainTaskQueue` can reconstruct the full `DispatchRequest`.
7. **Per-resource concurrency guard at drain time.** Before dispatching a queued task, `drainTaskQueue` must check that no other task is already running (`status='dispatched'` or `status='running'`) for the same Linear issue (`linearIssueId`) or GitHub PR (`repository` + `prNumber`). If a conflict is found, skip that task (leave it queued) and try the next oldest queued task. This prevents two agents from working on the same issue/PR simultaneously. The existing `hasActiveTaskForLinearIssue()` and `findActiveReviewForPR()` repository methods can be reused for these checks.
8. **`drainRetryQueue` is a legacy second dispatch path.** It dispatches entries from the `dispatch_retries` collection. After this refactoring, no new retry entries are created (the `createTaskForPR` retry-entry creation is removed). `drainRetryQueue` is kept intact to drain any existing entries created before deployment. Once the collection is empty, it becomes a no-op. A follow-up cleanup task can remove it entirely.

---

## Endpoint Changes

### Modified
- `POST /code/submit` - No longer dispatches directly; returns immediately after enqueue
- `POST /code/retry` - Same change
- `POST /code/tasks/:taskId/implement` - Same change
- `POST /internal/code/process` - Same change (actions-agent path)
- `POST /webhooks/github` - PR comment / review tasks enqueued instead of dispatched
- `POST /internal/code/submit-phase2` - Same change

### Created
- `GET /code/queue` - Returns currently queued tasks for authenticated user (JWT auth)

### Unchanged
- `POST /internal/drain-queue` - Still called by Cloud Scheduler; now the SOLE dispatch path
- `POST /internal/webhooks/task-complete` - Unchanged
- `POST /internal/code/detect-zombies` - Unchanged
- `POST /internal/code/heartbeat` - Unchanged
- All other existing endpoints

---

## File Structure

### New Files

| File                                                                       | Responsibility                                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/code-agent/src/domain/services/taskEnqueueService.ts`                | Interface for `TaskEnqueueService`                                      |
| `apps/code-agent/src/infra/services/taskEnqueueServiceImpl.ts`             | Implementation: validates queue capacity, writes task metadata, returns |
| `apps/code-agent/src/domain/services/__tests__/taskEnqueueService.test.ts` | Unit tests for enqueue service                                          |
| `apps/web/src/pages/DispatchQueuePage.tsx`                                 | New read-only queue view page                                           |
| `apps/web/src/hooks/useDispatchQueue.ts`                                   | Hook: Firestore real-time listener for queued tasks                     |
| `apps/web/src/hooks/__tests__/useDispatchQueue.test.ts`                    | Tests for the hook                                                      |

### Modified Files

| File                                                                    | Change                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/code-agent/src/domain/models/codeTask.ts`                         | Add `planningPrBranch?`, `planningPrUrl?`, `trackingCommentId?` fields               |
| `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`         | Add `planningPrBranch?`, `planningPrUrl?`, `trackingCommentId?` to `CreateTaskInput` |
| `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts` | Persist new fields                                                                   |
| `apps/code-agent/src/services.ts`                                       | Register `TaskEnqueueService` in DI container                                        |
| `apps/code-agent/src/domain/usecases/processCodeAction.ts`              | Remove dispatch+queue logic, call `enqueue()`                                        |
| `apps/code-agent/src/domain/usecases/retryTask.ts`                      | Remove dispatch+queue logic, call `enqueue()`                                        |
| `apps/code-agent/src/domain/usecases/createTaskForPR.ts`                | Remove dispatch+queue logic, call `enqueue()`                                        |
| `apps/code-agent/src/domain/usecases/createReviewTask.ts`               | Remove dispatch+queue logic, call `enqueue()`                                        |
| `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`         | Remove dispatch+queue logic, call `enqueue()`                                        |
| `apps/code-agent/src/domain/usecases/detectMergeConflictsOnPush.ts`     | Remove dispatch+queue logic, call `enqueue()`                                        |
| `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts`             | Remove dispatch+queue logic, call `enqueue()`                                        |
| `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`                 | Per-resource concurrency guard + reconstruct full `DispatchRequest` with new fields  |
| `apps/code-agent/src/routes/codeRoutes.ts`                              | Refactor `POST /code/submit` inline dispatch + Add `GET /code/queue` endpoint        |
| `apps/web/src/App.tsx`                                                  | Add route for `/#/code-tasks/dispatch-queue`                                         |
| `apps/web/src/services/codeAgentApi.ts`                                 | Add `getDispatchQueue()` API function                                                |
| `firestore-collections.json`                                            | No change needed (code_tasks already owned by code-agent)                            |

### Test Files Modified (update dispatch mocks → enqueue mocks)

| File                                                                   | Change                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| All test files for the 7 refactored usecases                           | Replace `taskDispatcher.dispatch()` mocks with `taskEnqueueService.enqueue()` mocks |
| `apps/code-agent/src/routes/__tests__/codeRoutes.test.ts`              | Add tests for `GET /code/queue` endpoint                                            |
| `apps/code-agent/src/domain/usecases/__tests__/drainTaskQueue.test.ts` | Update to test concurrency guard + new field reconstruction                         |

---

## Shared Types & Contracts

### TaskEnqueueService Interface

```typescript
// apps/code-agent/src/domain/services/taskEnqueueService.ts

import type { Result, Logger } from '@intexuraos/common-core';

export interface EnqueueTaskInput {
  taskId: string;
  userId: string;
}

export interface EnqueueResult {
  taskId: string;
  queuePosition: number;
  estimatedWaitMinutes: number;
}

export interface EnqueueError {
  code: 'queue_full' | 'task_not_found' | 'internal_error';
  message: string;
}

export interface TaskEnqueueServiceDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  whatsappNotifier: WhatsAppNotifier;
}

export interface TaskEnqueueService {
  /**
   * Enqueue a task for dispatch. The task MUST already exist in Firestore
   * with status='queued' (set at creation time via codeTaskRepo.create()).
   *
   * This method:
   * 1. Validates queue capacity (countQueued vs maxSize)
   * 2. Sets queuedAt timestamp on the task
   * 3. Sends WhatsApp notification with queue position
   * 4. Returns queue position info
   *
   * If queue is full, marks the task as failed and returns queue_full error.
   */
  enqueue(input: EnqueueTaskInput): Promise<Result<EnqueueResult, EnqueueError>>;
}
```

### New CodeTask Fields

```typescript
// Added to CodeTask interface in codeTask.ts
export interface CodeTask {
  // ... existing fields ...

  // Dispatch metadata for queue reconstruction (INT-949)
  planningPrBranch?: string;     // Branch name of planning PR to merge into execution worktree
  planningPrUrl?: string;        // PR URL to close after successful execution
  trackingCommentId?: string;    // Existing PR tracking comment to reuse
}
```

### GET /code/queue Response

```typescript
// Response shape for GET /code/queue
interface QueueResponse {
  success: true;
  data: {
    tasks: Array<{
      id: string;
      prompt: string;          // First 200 chars, truncated
      linearIssueId?: string;
      workerType: string;
      agentType?: string;
      queuedAt: string;        // ISO timestamp
      createdAt: string;       // ISO timestamp
      position: number;        // 1-based position in queue
    }>;
    totalQueued: number;
    maxQueueSize: number;
  };
}
```

### Firestore Security Rules for Real-Time Queue View

The web app already has Firestore access to `code_tasks` collection via Firebase Auth (Auth0 token exchange). The existing `onSnapshot` pattern in `useCodeTaskLogs.ts` already demonstrates read access to `code_tasks/{taskId}`. No new security rules are needed since:
1. The web app already authenticates via Firebase custom token
2. The existing rules allow reading `code_tasks` documents
3. The queue view uses the same Firestore collection, just filtered by `status='queued'`

If rules need tightening (userId-scoped reads), this is already enforced at the API layer via JWT auth.

---

## Subtask 1: Code-Agent Backend — Unified Enqueue Service & Usecase Refactoring

**Owner:** code-agent service agent
**Service boundary:** `apps/code-agent/`
**Dependencies:** None (this subtask defines the contracts that subtask 2 consumes)

### Task 1.1: Add Dispatch Metadata Fields to CodeTask Model

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`

- [ ] **Step 1: Add fields to CodeTask interface**

In `apps/code-agent/src/domain/models/codeTask.ts`, add three fields to the `CodeTask` interface after the `cancelNonceExpiresAt` field:

```typescript
  // Dispatch metadata for queue reconstruction (INT-949)
  planningPrBranch?: string;     // Planning PR branch to merge into execution worktree
  planningPrUrl?: string;        // Planning PR URL to close after execution
  trackingCommentId?: string;    // PR tracking comment ID to reuse for pull_request tasks
```

- [ ] **Step 2: Add fields to CreateTaskInput**

In `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`, add to `CreateTaskInput`:

```typescript
  // Dispatch metadata stored for queue-based dispatch (INT-949)
  planningPrBranch?: string;
  planningPrUrl?: string;
  trackingCommentId?: string;
```

- [ ] **Step 3: Persist new fields in Firestore repository**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, find the `create()` method. In the document data object that gets written to Firestore, add the three new fields with conditional inclusion:

```typescript
...(input.planningPrBranch !== undefined && { planningPrBranch: input.planningPrBranch }),
...(input.planningPrUrl !== undefined && { planningPrUrl: input.planningPrUrl }),
...(input.trackingCommentId !== undefined && { trackingCommentId: input.trackingCommentId }),
```

Also update the `toCodeTask()` mapping function to read these fields from Firestore document data:

```typescript
planningPrBranch: data['planningPrBranch'] as string | undefined,
planningPrUrl: data['planningPrUrl'] as string | undefined,
trackingCommentId: data['trackingCommentId'] as string | undefined,
```

- [ ] **Step 4: Run tests to verify nothing breaks**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: All existing tests pass (new fields are optional, backward-compatible)

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts \
        apps/code-agent/src/domain/repositories/codeTaskRepository.ts \
        apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts
git commit -m "feat(code-agent): add dispatch metadata fields to CodeTask model (INT-949)"
```

---

### Task 1.2: Create TaskEnqueueService Interface and Implementation

**Files:**
- Create: `apps/code-agent/src/domain/services/taskEnqueueService.ts`
- Create: `apps/code-agent/src/infra/services/taskEnqueueServiceImpl.ts`
- Create: `apps/code-agent/src/domain/services/__tests__/taskEnqueueService.test.ts`
- Modify: `apps/code-agent/src/services.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/code-agent/src/domain/services/__tests__/taskEnqueueService.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { TaskEnqueueServiceImpl } from '../../../infra/services/taskEnqueueServiceImpl.js';
import type { TaskEnqueueService } from '../taskEnqueueService.js';
import type { CodeTaskRepository } from '../../repositories/codeTaskRepository.js';
import type { WhatsAppNotifier } from '../whatsappNotifier.js';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../../models/codeTask.js';
import { Timestamp } from '@google-cloud/firestore';

function createFakeLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => createFakeLogger(),
  } as unknown as Logger;
}

function createFakeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-1',
    traceId: 'trace-1',
    userId: 'user-1',
    workerType: 'auto',
    workerLocation: 'queued',
    status: 'queued',
    prompt: 'test prompt',
    sanitizedPrompt: 'test prompt',
    systemPromptHash: 'hash-1',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    callbackReceived: false,
    dedupKey: 'dedup-1',
    ...overrides,
  };
}

describe('TaskEnqueueServiceImpl', () => {
  let service: TaskEnqueueService;
  let codeTaskRepo: CodeTaskRepository;
  let whatsappNotifier: WhatsAppNotifier;

  beforeEach(() => {
    const fakeTask = createFakeTask();
    codeTaskRepo = {
      findById: async () => ok(fakeTask),
      countQueued: async () => ok(2),
      update: async (_id: string, _input: unknown) => ok(fakeTask),
    } as unknown as CodeTaskRepository;

    whatsappNotifier = {
      notifyTaskQueued: async () => ok(undefined),
    } as unknown as WhatsAppNotifier;

    service = new TaskEnqueueServiceImpl({
      logger: createFakeLogger(),
      codeTaskRepo,
      whatsappNotifier,
    });
  });

  it('should enqueue a task and return queue position', async () => {
    const result = await service.enqueue({ taskId: 'task-1', userId: 'user-1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskId).toBe('task-1');
      expect(result.value.queuePosition).toBe(2);
    }
  });

  it('should return queue_full when queue exceeds max size', async () => {
    codeTaskRepo.countQueued = async () => ok(999);
    codeTaskRepo.update = async (_id: string) => ok(createFakeTask({ status: 'failed' }));

    const result = await service.enqueue({ taskId: 'task-1', userId: 'user-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('queue_full');
    }
  });

  it('should return task_not_found when task does not exist', async () => {
    codeTaskRepo.findById = async () => err({ code: 'NOT_FOUND' as const, message: 'not found' });

    const result = await service.enqueue({ taskId: 'nonexistent', userId: 'user-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_found');
    }
  });

  it('should set queuedAt timestamp on the task', async () => {
    let updatedFields: Record<string, unknown> = {};
    codeTaskRepo.update = async (_id: string, input: unknown) => {
      updatedFields = input as Record<string, unknown>;
      return ok(createFakeTask());
    };

    await service.enqueue({ taskId: 'task-1', userId: 'user-1' });
    expect(updatedFields['queuedAt']).toBeInstanceOf(Date);
  });

  it('should send WhatsApp notification with queue position', async () => {
    let notifyCalled = false;
    whatsappNotifier.notifyTaskQueued = async () => {
      notifyCalled = true;
      return ok(undefined);
    };

    await service.enqueue({ taskId: 'task-1', userId: 'user-1' });
    expect(notifyCalled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: FAIL — modules not found

- [ ] **Step 3: Create the interface**

Create `apps/code-agent/src/domain/services/taskEnqueueService.ts`:

```typescript
/**
 * Unified task enqueue service (INT-949).
 *
 * The ONLY way to submit tasks for dispatch. Replaces direct
 * taskDispatcher.dispatch() calls in all usecases.
 *
 * Every task goes through the persistent Firestore queue.
 * The drainTaskQueue Cloud Scheduler job dispatches them one at a time.
 */

import type { Result } from '@intexuraos/common-core';

export interface EnqueueTaskInput {
  /** ID of the task to enqueue (must already exist in Firestore with status='queued'). */
  taskId: string;
  /** User ID who owns the task (for WhatsApp notification). */
  userId: string;
}

export interface EnqueueResult {
  taskId: string;
  queuePosition: number;
  estimatedWaitMinutes: number;
}

export interface EnqueueError {
  code: 'queue_full' | 'task_not_found' | 'internal_error';
  message: string;
}

export interface TaskEnqueueService {
  /**
   * Enqueue a task for dispatch.
   *
   * The task MUST already exist in Firestore with status='queued'
   * (set at creation time via codeTaskRepo.create()).
   *
   * This method:
   * 1. Validates the task exists
   * 2. Checks queue capacity (countQueued vs config.queue.maxSize)
   * 3. Sets queuedAt timestamp on the task
   * 4. Sends WhatsApp notification with queue position
   * 5. Returns queue position info
   *
   * If queue is full, marks the task as failed and returns queue_full error.
   */
  enqueue(input: EnqueueTaskInput): Promise<Result<EnqueueResult, EnqueueError>>;
}
```

- [ ] **Step 4: Create the implementation**

Create `apps/code-agent/src/infra/services/taskEnqueueServiceImpl.ts`:

```typescript
/**
 * Implementation of TaskEnqueueService (INT-949).
 *
 * Validates queue capacity and stamps queuedAt on the task.
 * Does NOT dispatch — drainTaskQueue handles that.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type {
  TaskEnqueueService,
  EnqueueTaskInput,
  EnqueueResult,
  EnqueueError,
} from '../../domain/services/taskEnqueueService.js';
import { loadConfig } from '../../config.js';

export interface TaskEnqueueServiceImplDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  whatsappNotifier: WhatsAppNotifier;
}

export class TaskEnqueueServiceImpl implements TaskEnqueueService {
  private readonly logger: Logger;
  private readonly codeTaskRepo: CodeTaskRepository;
  private readonly whatsappNotifier: WhatsAppNotifier;

  constructor(deps: TaskEnqueueServiceImplDeps) {
    this.logger = deps.logger;
    this.codeTaskRepo = deps.codeTaskRepo;
    this.whatsappNotifier = deps.whatsappNotifier;
  }

  async enqueue(input: EnqueueTaskInput): Promise<Result<EnqueueResult, EnqueueError>> {
    const { taskId, userId } = input;
    const config = loadConfig();

    // Step 1: Verify task exists
    const findResult = await this.codeTaskRepo.findById(taskId);
    if (!findResult.ok) {
      this.logger.error({ taskId, error: findResult.error }, 'Task not found for enqueue');
      return err({ code: 'task_not_found', message: `Task ${taskId} not found` });
    }

    const task = findResult.value;

    // Step 2: Check queue capacity
    const countResult = await this.codeTaskRepo.countQueued();
    if (!countResult.ok) {
      this.logger.error({ error: countResult.error }, 'Failed to count queued tasks');
      return err({ code: 'internal_error', message: 'Failed to check queue capacity' });
    }

    const queueCount = countResult.value;

    if (queueCount > config.queue.maxSize) {
      // Queue is full — mark task as failed
      await this.codeTaskRepo.update(taskId, {
        status: 'failed',
        error: {
          code: 'queue_full',
          message: `All workers are busy and the queue is full (${String(queueCount)}/${String(config.queue.maxSize)}). Please try again in a few minutes.`,
        },
      });

      this.logger.warn({ taskId, queueCount, maxSize: config.queue.maxSize }, 'Queue full, task failed');
      return err({
        code: 'queue_full',
        message: 'All workers are busy and the queue is full. Please try again in a few minutes.',
      });
    }

    // Step 3: Set queuedAt timestamp
    const updateResult = await this.codeTaskRepo.update(taskId, {
      queuedAt: new Date(),
    });

    if (!updateResult.ok) {
      this.logger.error({ taskId, error: updateResult.error }, 'Failed to update task with queuedAt');
      return err({ code: 'internal_error', message: 'Failed to update task queue timestamp' });
    }

    // Step 4: Send WhatsApp notification (best-effort)
    const queuePosition = queueCount;
    const estimatedWaitMinutes = Math.min(queuePosition * 5, config.queue.ttlMinutes);

    const notifyResult = await this.whatsappNotifier.notifyTaskQueued(
      userId,
      updateResult.value,
      queuePosition,
      estimatedWaitMinutes,
    );

    if (!notifyResult.ok) {
      this.logger.warn({ taskId, error: notifyResult.error }, 'Failed to send queue notification');
    }

    this.logger.info({ taskId, queuePosition, estimatedWaitMinutes }, 'Task enqueued for dispatch');

    return ok({
      taskId,
      queuePosition,
      estimatedWaitMinutes,
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 6: Register in DI container**

In `apps/code-agent/src/services.ts`:

1. Add import:
```typescript
import type { TaskEnqueueService } from './domain/services/taskEnqueueService.js';
import { TaskEnqueueServiceImpl } from './infra/services/taskEnqueueServiceImpl.js';
```

2. Add to the `ServiceContainer` interface:
```typescript
taskEnqueueService: TaskEnqueueService;
```

3. In the `initServices()` function, create the instance:
```typescript
const taskEnqueueService = new TaskEnqueueServiceImpl({
  logger: logger.child({ service: 'task-enqueue' }),
  codeTaskRepo,
  whatsappNotifier,
});
```

4. Add to the returned container object:
```typescript
taskEnqueueService,
```

5. Search for ALL test files that call `setServices()` and add the new `taskEnqueueService` field to their service mocks. Use this command to find them:
```bash
rg "setServices\(" apps/code-agent/src --files-with-matches
```
For each file, add a fake `taskEnqueueService` to the `setServices()` call:
```typescript
taskEnqueueService: {
  enqueue: async () => ok({ taskId: 'test', queuePosition: 0, estimatedWaitMinutes: 0 }),
} as unknown as TaskEnqueueService,
```

- [ ] **Step 7: Run tests**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/code-agent/src/domain/services/taskEnqueueService.ts \
        apps/code-agent/src/infra/services/taskEnqueueServiceImpl.ts \
        apps/code-agent/src/domain/services/__tests__/taskEnqueueService.test.ts \
        apps/code-agent/src/services.ts
git commit -m "feat(code-agent): add TaskEnqueueService for unified task dispatch (INT-949)"
```

---

### Task 1.3: Refactor processCodeAction to Use Enqueue Service

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts`
- Modify: `apps/code-agent/src/domain/usecases/__tests__/processCodeAction.test.ts`

This is the template refactoring — all other usecases follow the same pattern.

- [ ] **Step 1: Update the deps interface**

In `processCodeAction.ts`, change `ProcessCodeActionDeps`:
- Remove: `taskDispatcher: TaskDispatcherService`
- Add: `taskEnqueueService: TaskEnqueueService`

Add import:
```typescript
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
```

Remove imports that are no longer needed:
```typescript
// Remove: import type { TaskDispatcherService, DispatchWorkerCredentials } from '../services/taskDispatcher.js';
// Remove: import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
// Remove: import { generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';
```

Also remove `workerSettingsRepo` and `orchestratorSecret` from `ProcessCodeActionDeps` since they were only used for building DispatchRequest/credentials. However, `workerSettingsRepo` may be needed for checking if user has workers configured (validation step). Check the code — if it's used for validation before dispatch, keep it. If only for building `DispatchWorkerCredentials`, remove it.

**Important:** Keep the `metricsClient` dependency — metrics recording stays in the usecase.

- [ ] **Step 2: Replace dispatch+queue block with enqueue call**

Find the block that starts with building the `dispatchRequest` object (around line 270) and ends with the success return (around line 404). Replace the entire block (Steps 7-10 in the current code) with:

```typescript
  // Step 7: Enqueue task for dispatch (INT-949)
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: task.id,
    userId,
  });

  if (!enqueueResult.ok) {
    if (enqueueResult.error.code === 'queue_full') {
      return err({ code: 'queue_full', message: enqueueResult.error.message });
    }
    return err({ code: 'internal_error', message: enqueueResult.error.message });
  }

  // Step 8: Record metrics for task submission
  const source = request.source ?? 'web';
  try {
    await deps.metricsClient.incrementTasksSubmitted(effectiveWorkerType, source);
  } catch (error: unknown) {
    logger.error({ error, taskId: task.id, workerType: effectiveWorkerType, source }, 'Failed to record task submission metric');
  }

  // Step 9: Return success — task is in queue, drainTaskQueue will dispatch it
  return ok({
    codeTaskId: task.id,
    resourceUrl: `/#/code-tasks/${task.id}`,
    workerLocation: 'queued' as WorkerLocation,
  });
```

**Critical:** Also remove the `WorkerSettingsRepository` fetch block (the part that fetches worker settings and builds `workerCredentials`) since that's no longer needed. This is the block that calls `workerSettingsRepo.getSettings(userId)` and builds `DispatchWorkerCredentials`.

**Note about worker validation:** If the usecase currently validates that the user has workers configured before dispatching (e.g., returns `worker_not_configured` error), you should KEEP that validation check but REMOVE the `DispatchWorkerCredentials` building. The validation ensures users aren't queuing tasks they can never dispatch.

- [ ] **Step 3: Update tests**

In the test file, replace all `taskDispatcher.dispatch()` mock setups with `taskEnqueueService.enqueue()` mocks:

- Replace `taskDispatcher: { dispatch: async () => ok({ dispatched: true, workerLocation: 'mac-1' }) }` with `taskEnqueueService: { enqueue: async () => ok({ taskId: 'test', queuePosition: 0, estimatedWaitMinutes: 0 }) }`
- Update test assertions: `workerLocation` will now always be `'queued'` in the result
- Remove any tests that test the at_capacity fallback logic (that's now in the enqueue service)
- Add a test for `queue_full` error propagation from enqueue

- [ ] **Step 4: Run tests**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/processCodeAction.ts \
        apps/code-agent/src/domain/usecases/__tests__/processCodeAction.test.ts
git commit -m "refactor(code-agent): processCodeAction uses enqueue service (INT-949)"
```

---

### Task 1.4: Refactor retryTask to Use Enqueue Service

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/__tests__/retryTask.test.ts`

Follow the same pattern as Task 1.3:

- [ ] **Step 1: Update deps interface**

Replace `taskDispatcher: TaskDispatcherService` with `taskEnqueueService: TaskEnqueueService` in the deps type. Remove `WorkerSettingsRepository` if only used for dispatch credentials. Remove imports for `DispatchWorkerCredentials`, `generateCancelNonce`, `CANCEL_NONCE_TTL_MS`.

- [ ] **Step 2: Replace dispatch+queue block with enqueue call**

Find the block after task creation where `dispatchRequest` is built and `taskDispatcher.dispatch()` is called (around lines 380-490). Replace with:

```typescript
  // Enqueue retry task for dispatch (INT-949)
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: retryTask.id,
    userId,
  });

  if (!enqueueResult.ok) {
    if (enqueueResult.error.code === 'queue_full') {
      return err({ code: 'queue_full', message: enqueueResult.error.message });
    }
    return err({ code: 'internal_error', message: enqueueResult.error.message });
  }

  return ok({
    codeTaskId: retryTask.id,
    resourceUrl: `/#/code-tasks/${retryTask.id}`,
    workerLocation: 'queued' as WorkerLocation,
    retriedFrom: originalTaskId,
  });
```

Keep the archive-original-task logic that runs after successful dispatch — it should now run after successful enqueue.

- [ ] **Step 3: Update tests**

Same pattern as Task 1.3.

- [ ] **Step 4: Run tests and commit**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

```bash
git add apps/code-agent/src/domain/usecases/retryTask.ts \
        apps/code-agent/src/domain/usecases/__tests__/retryTask.test.ts
git commit -m "refactor(code-agent): retryTask uses enqueue service (INT-949)"
```

---

### Task 1.5: Refactor createTaskForPR to Use Enqueue Service

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createTaskForPR.ts`
- Modify: `apps/code-agent/src/domain/usecases/__tests__/createTaskForPR.test.ts`

Follow the same pattern. **Special considerations:**

- [ ] **Step 1: Store trackingCommentId on task at creation time**

This usecase passes `trackingCommentId` in the DispatchRequest. Since tasks are now created first and dispatched later by drainTaskQueue, this field must be stored on the task at creation time. Update the `codeTaskRepo.create()` call to include `trackingCommentId` if it exists in the request.

- [ ] **Step 2: Remove dispatch_retries creation**

The current code creates `dispatch_retries` entries on retryable dispatch errors. Since there's no more direct dispatch, this entire block can be removed. The `dispatch_retries` collection may become unused if drainRetryQueue is the only consumer — but leave drainRetryQueue intact for now as it handles existing retry entries during migration.

- [ ] **Step 3: Replace dispatch block with enqueue call**

Same pattern as other usecases.

- [ ] **Step 4: Update tests and commit**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

```bash
git add apps/code-agent/src/domain/usecases/createTaskForPR.ts \
        apps/code-agent/src/domain/usecases/__tests__/createTaskForPR.test.ts
git commit -m "refactor(code-agent): createTaskForPR uses enqueue service (INT-949)"
```

---

### Task 1.6: Refactor createReviewTask to Use Enqueue Service

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/__tests__/createReviewTask.test.ts`

Follow the same pattern as Task 1.3.

- [ ] **Step 1-4: Same as other usecases**

Replace dispatch block with enqueue. Update deps. Update tests. Commit.

```bash
git commit -m "refactor(code-agent): createReviewTask uses enqueue service (INT-949)"
```

---

### Task 1.7: Refactor submitToExecutionAgent to Use Enqueue Service

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`
- Modify: `apps/code-agent/src/domain/usecases/__tests__/submitToExecutionAgent.test.ts`

**Special considerations:**

- [ ] **Step 1: Store planningPrBranch and planningPrUrl on execution task at creation**

This usecase reads `originalTask.result?.branch` and `originalTask.result?.planning_pr_url` and passes them as `planningPrBranch` and `planningPrUrl` in the DispatchRequest. These must now be stored on the execution task at creation time via the `CreateTaskInput`:

```typescript
// In the codeTaskRepo.create() call, add:
planningPrBranch: originalTask.result?.branch,
planningPrUrl: originalTask.result?.planning_pr_url,
```

- [ ] **Step 2: Handle rollback on queue_full**

The current code rolls back `implementationTaskId` on the parent task when dispatch fails. This rollback logic must remain for the `queue_full` error case from enqueue:

```typescript
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: executionTaskId,
    userId,
  });

  if (!enqueueResult.ok) {
    if (enqueueResult.error.code === 'queue_full') {
      // Rollback implementationTaskId on planning task
      await codeTaskRepo.update(originalTask.id, { implementationTaskId: null });
      await codeTaskRepo.update(executionTaskId, {
        status: 'failed',
        error: { code: 'queue_full', message: enqueueResult.error.message },
      });
      return err({ code: 'queue_full', message: enqueueResult.error.message });
    }
    // Same rollback for other errors
    await codeTaskRepo.update(originalTask.id, { implementationTaskId: null });
    return err({ code: 'internal_error', message: enqueueResult.error.message });
  }
```

- [ ] **Step 3: Update tests and commit**

```bash
git commit -m "refactor(code-agent): submitToExecutionAgent uses enqueue service (INT-949)"
```

---

### Task 1.8: Refactor detectMergeConflictsOnPush to Use Enqueue Service

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/detectMergeConflictsOnPush.ts`
- Modify: `apps/code-agent/src/domain/usecases/__tests__/detectMergeConflictsOnPush.test.ts`

Follow the same pattern. This usecase had minimal queue handling.

- [ ] **Step 1-4: Same as other usecases**

```bash
git commit -m "refactor(code-agent): detectMergeConflictsOnPush uses enqueue service (INT-949)"
```

---

### Task 1.9: Refactor submitTaskFeedback to Use Enqueue Service

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts`
- Modify: `apps/code-agent/src/domain/usecases/__tests__/submitTaskFeedback.test.ts`

This usecase previously had **NO queue fallback** — it just failed on any dispatch error. By using the enqueue service, it now properly queues tasks like all others.

- [ ] **Step 1-4: Same as other usecases**

```bash
git commit -m "refactor(code-agent): submitTaskFeedback uses enqueue service (INT-949)"
```

---

### Task 1.10: Update drainTaskQueue — Per-Resource Concurrency Guard & New Field Reconstruction

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- Modify: `apps/code-agent/src/domain/usecases/__tests__/drainTaskQueue.test.ts`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`

#### Per-Resource Concurrency Guard

When all tasks go through the queue, multiple tasks for the same Linear issue or GitHub PR can be queued simultaneously (e.g., a planning task completes → execution task is enqueued, while a PR comment also triggers a new task for the same issue). Without a guard, `drainTaskQueue` would dispatch them back-to-back, resulting in two agents racing on the same resource.

**Rule:** At most ONE task may be in `dispatched` or `running` status per Linear issue (`linearIssueId`) or GitHub PR (`repository` + `prNumber`). If a queued task's resource already has an active task, skip it and try the next queued task.

- [ ] **Step 1: Add `listQueuedByAge` method to repository**

The current `findOldestQueued()` returns a single task. The concurrency guard needs to try multiple candidates in case the oldest is blocked. Add a new method:

In `codeTaskRepository.ts`:
```typescript
  /**
   * List queued tasks ordered by queuedAt ascending (FIFO), limited to `limit`.
   * Used by drainTaskQueue to find dispatchable candidates (INT-949).
   */
  listQueuedByAge(limit: number): Promise<Result<CodeTask[], RepositoryError>>;
```

In `firestoreCodeTaskRepository.ts`:
```typescript
listQueuedByAge: async (limit: number): Promise<Result<CodeTask[], RepositoryError>> => {
  try {
    const snapshot = await collection
      .where('status', '==', 'queued')
      .orderBy('queuedAt', 'asc')
      .limit(limit)
      .get();
    return ok(snapshot.docs.map((doc) => toCodeTask(doc as { id: string; data(): Record<string, unknown> })));
  } catch (error) {
    return err({ code: 'FIRESTORE_ERROR', message: `Firestore error: ${getErrorMessage(error)}` });
  }
},
```

Also add `listQueuedByAge` to all test fakes (same search as Task 1.12):
```typescript
listQueuedByAge: async () => ok([]),
```

- [ ] **Step 2: Refactor drainTaskQueue to iterate candidates with concurrency check**

Replace the current single-task approach:
```typescript
// OLD:
const findResult = await codeTaskRepo.findOldestQueued();
const task = findResult.value;
if (task === null) return ok({ action: 'empty' });
// ... dispatch task
```

With a candidate-iteration loop:
```typescript
// NEW: Fetch up to 10 queued candidates
const candidatesResult = await codeTaskRepo.listQueuedByAge(10);
if (!candidatesResult.ok) {
  logger.error({ error: candidatesResult.error }, 'Failed to list queued tasks');
  return err({ code: 'internal_error', message: candidatesResult.error.message });
}

const candidates = candidatesResult.value;
if (candidates.length === 0) {
  logger.info({ queue: 'empty' }, 'No queued tasks to drain');
  return ok({ action: 'empty' });
}

// Find first dispatchable candidate (no active task for same resource)
let task: CodeTask | null = null;
for (const candidate of candidates) {
  // Check Linear issue concurrency
  if (candidate.linearIssueId !== undefined) {
    const activeResult = await codeTaskRepo.hasActiveTaskForLinearIssue(candidate.linearIssueId);
    if (activeResult.ok && activeResult.value.hasActive && activeResult.value.taskId !== candidate.id) {
      logger.info({
        taskId: candidate.id,
        linearIssueId: candidate.linearIssueId,
        activeTaskId: activeResult.value.taskId,
      }, 'Skipping queued task — active task exists for same Linear issue');
      continue;
    }
  }

  // Check PR concurrency (for PR-scoped tasks like review/pull_request agents)
  if (candidate.prNumber !== undefined && candidate.repository !== undefined) {
    const prActiveResult = await codeTaskRepo.findActiveReviewForPR(candidate.repository, candidate.prNumber);
    if (prActiveResult.ok && prActiveResult.value !== null && prActiveResult.value.id !== candidate.id) {
      logger.info({
        taskId: candidate.id,
        repository: candidate.repository,
        prNumber: candidate.prNumber,
        activeTaskId: prActiveResult.value.id,
      }, 'Skipping queued task — active task exists for same PR');
      continue;
    }
  }

  task = candidate;
  break;
}

if (task === null) {
  logger.info({ candidateCount: candidates.length }, 'All queued tasks blocked by active resources');
  return ok({ action: 'still_busy' });
}

// ... rest of drain logic (TTL check, dispatch, etc.) uses `task`
```

**Important notes:**
- `hasActiveTaskForLinearIssue` returns tasks with status in `['queued', 'dispatched', 'running']`. We only want to block on `dispatched`/`running`, NOT `queued`. Since the candidate itself is `queued`, compare `activeResult.value.taskId !== candidate.id` to avoid self-blocking. But queued-vs-queued conflicts are fine — both are waiting, only one will be dispatched.
- The `findActiveReviewForPR` method filters `agentType === 'review'`. For broader PR concurrency (not just reviews), you may want a more general `hasActiveTaskForPR(repository, prNumber)` method. Check if the existing method suffices or a new one is needed.

- [ ] **Step 3: Add new fields to DispatchRequest reconstruction**

In the dispatch call (after the candidate loop), add the new fields from the task document:

```typescript
const dispatchResult = await taskDispatcher.dispatch({
  taskId: task.id,
  prompt: task.sanitizedPrompt,
  systemPromptHash: task.systemPromptHash,
  repository: task.repository,
  baseBranch: task.baseBranch,
  workerType: task.workerType,
  webhookUrl,
  webhookSecret: task.webhookSecret ?? '',
  traceId: task.traceId,
  workerCredentials,
  linearIssueLabels: dispatchLabels,
  hasChildren,
  agentType,
  ...(task.retriedFrom !== undefined && { retriedFrom: task.retriedFrom }),
  ...(task.prNumber !== undefined && task.prBranch !== undefined && {
    continuationPrNumber: task.prNumber,
    continuationPrBranch: task.prBranch,
  }),
  ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
  // INT-949: New dispatch metadata fields
  ...(task.planningPrBranch !== undefined && { planningPrBranch: task.planningPrBranch }),
  ...(task.planningPrUrl !== undefined && { planningPrUrl: task.planningPrUrl }),
  ...(task.trackingCommentId !== undefined && { trackingCommentId: task.trackingCommentId }),
});
```

- [ ] **Step 4: Write tests**

Add test cases to `drainTaskQueue.test.ts`:

**Concurrency guard tests:**
- Task with `linearIssueId` is skipped when `hasActiveTaskForLinearIssue` returns `hasActive: true` for a different task
- Task with `prNumber` is skipped when `findActiveReviewForPR` returns an active task for the same PR
- Task without `linearIssueId` or `prNumber` is not subject to concurrency check (dispatches normally)
- When first candidate is blocked, second candidate is dispatched
- When all candidates are blocked, returns `still_busy`
- Task is NOT self-blocked (its own ID doesn't count as a conflict)

**New field reconstruction tests:**
- A task with `planningPrBranch` set passes it through to the dispatch request
- A task with `planningPrUrl` set passes it through
- A task with `trackingCommentId` set passes it through
- A task without these fields omits them from the dispatch request

- [ ] **Step 5: Run tests and commit**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

```bash
git add apps/code-agent/src/domain/usecases/drainTaskQueue.ts \
        apps/code-agent/src/domain/usecases/__tests__/drainTaskQueue.test.ts \
        apps/code-agent/src/domain/repositories/codeTaskRepository.ts \
        apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts
git commit -m "refactor(code-agent): drainTaskQueue with concurrency guard and full dispatch request (INT-949)"
```

---

### Task 1.11: Refactor POST /code/submit Inline Route Handler & Update Route Wiring

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`
- Modify: `apps/code-agent/src/routes/__tests__/codeRoutes.test.ts`

The `POST /code/submit` route handler (lines 1250-1498 of `codeRoutes.ts`) contains its own inline dispatch logic that duplicates the usecase pattern. This is the **8th dispatch call site** and must be refactored.

- [ ] **Step 1: Refactor POST /code/submit inline dispatch to use enqueue**

In `codeRoutes.ts`, find the `POST /code/submit` route handler. After the task creation and `backLinkPlanningTask` call (around line 1336), the current code:
1. Fetches worker settings (lines 1338-1357)
2. Validates workers configured (lines 1353-1357)
3. Builds workerCredentials (lines 1379-1387)
4. Builds dispatchInput (lines 1390-1423)
5. Calls `taskDispatcher.dispatch(dispatchInput)` (line 1425)
6. Handles at_capacity/queue fallback (lines 1427-1498)
7. Updates task status to 'dispatched' (lines 1478-1482)

**Replace ALL of steps 1-7** (lines 1338-1498) with:

```typescript
      // Enqueue task for dispatch (INT-949)
      const { taskEnqueueService } = getServices();
      const enqueueResult = await taskEnqueueService.enqueue({
        taskId: task.id,
        userId,
      });

      if (!enqueueResult.ok) {
        if (enqueueResult.error.code === 'queue_full') {
          return await reply.fail('QUEUE_FULL', enqueueResult.error.message);
        }
        return await reply.fail('INTERNAL_ERROR', enqueueResult.error.message);
      }

      // Record task start for rate limiting
      await rateLimitService.recordTaskStart(userId);

      // Mark Linear issue as In Progress after successful enqueue
      if (issueResult.linearIssueId !== undefined) {
        await linearIssueService.markInProgress(userId, issueResult.linearIssueId);
      }

      request.log.info({ taskId: task.id }, 'Code task enqueued for dispatch');

      return await reply.ok({
        status: 'submitted',
        codeTaskId: task.id,
      });
```

**Note:** Keep the worker validation check. Before the enqueue call, add a worker-configured check using `workerSettingsRepo`:

```typescript
      // Validate user has workers configured before queuing
      const settingsResult = await workerSettingsRepo.getSettings(userId);
      const enabledWorkers = settingsResult.ok === true ? (settingsResult.value?.workers.filter((w) => w.enabled) ?? []) : [];
      if (enabledWorkers.length === 0) {
        request.log.warn({ userId }, 'User has no workers configured');
        return await reply.fail('WORKER_NOT_CONFIGURED', 'Please configure your workers in Settings before submitting code tasks');
      }
```

- [ ] **Step 2: Update route handlers for all 7 refactored usecases**

Find every route handler that calls the 7 refactored usecases. For each, change the deps object to pass `taskEnqueueService` from `getServices()` instead of `taskDispatcher`.

Search for each usecase call and update the deps:
- `processCodeAction(deps, ...)` — ensure deps has `taskEnqueueService` instead of `taskDispatcher`
- `retryTask(deps, ...)` — same
- etc.

**Note:** `drainTaskQueue` still needs `taskDispatcher` — don't remove it from the drain route.

- [ ] **Step 3: Update route tests**

In `codeRoutes.test.ts`, update the `POST /code/submit` tests:
- Replace `taskDispatcher.dispatch()` mocks with `taskEnqueueService.enqueue()` mocks
- Remove tests for at_capacity fallback logic (now handled by enqueue service)
- Verify tests for worker-not-configured validation still pass
- Add test for queue_full error propagation

- [ ] **Step 4: Run tests and commit**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

```bash
git add apps/code-agent/src/routes/codeRoutes.ts \
        apps/code-agent/src/routes/__tests__/codeRoutes.test.ts
git commit -m "refactor(code-agent): POST /code/submit uses enqueue service + wire routes (INT-949)"
```

---

### Task 1.12: Add GET /code/queue Endpoint

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`
- Modify: Route test files

- [ ] **Step 1: Add listQueued method to repository and update test fakes**

In `codeTaskRepository.ts`, add:

```typescript
  /**
   * List all currently queued tasks, ordered by queuedAt ascending (FIFO).
   * Used by the dispatch queue API endpoint (INT-949).
   */
  listQueued(): Promise<Result<CodeTask[], RepositoryError>>;
```

Implement in `firestoreCodeTaskRepository.ts`:

```typescript
async listQueued(): Promise<Result<CodeTask[], RepositoryError>> {
  try {
    const snapshot = await this.collection
      .where('status', '==', 'queued')
      .orderBy('queuedAt', 'asc')
      .get();

    const tasks = snapshot.docs.map((doc) => this.toCodeTask(doc));
    return ok(tasks);
  } catch (error: unknown) {
    return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
  }
}
```

Also update all test fakes/mocks that implement `CodeTaskRepository`. Search for fake repositories:
```bash
rg "countQueued|CodeTaskRepository" apps/code-agent/src/__tests__ --files-with-matches
```
For each fake, add a `listQueued` method:
```typescript
listQueued: async () => ok([]),
```

- [ ] **Step 2: Add GET /code/queue route**

In `codeRoutes.ts`, add the route with JWT authentication:

```typescript
server.get('/code/queue', {
  preHandler: [requireAuth],
}, async (request, reply) => {
  logIncomingRequest(request, { message: 'Received request to GET /code/queue' });
  const { codeTaskRepo } = getServices();
  const config = loadConfig();

  const result = await codeTaskRepo.listQueued();
  if (!result.ok) {
    return reply.status(500).send({ success: false, error: { message: 'Failed to fetch queue' } });
  }

  const tasks = result.value.map((task, index) => ({
    id: task.id,
    prompt: task.sanitizedPrompt.slice(0, 200),
    linearIssueId: task.linearIssueId,
    workerType: task.workerType,
    agentType: task.agentType,
    queuedAt: task.queuedAt?.toDate().toISOString() ?? task.createdAt.toDate().toISOString(),
    createdAt: task.createdAt.toDate().toISOString(),
    position: index + 1,
  }));

  return reply.send({
    success: true,
    data: {
      tasks,
      totalQueued: tasks.length,
      maxQueueSize: config.queue.maxSize,
    },
  });
});
```

- [ ] **Step 3: Write test for the endpoint**

Add test in the route tests:

```typescript
it('GET /code/queue returns queued tasks', async () => {
  // Mock codeTaskRepo.listQueued to return 2 queued tasks
  // Assert response shape matches QueueResponse contract
  // Assert tasks are ordered by position (1-based)
  // Assert prompt is truncated to 200 chars
});

it('GET /code/queue requires authentication', async () => {
  // Call without auth header
  // Assert 401 response
});
```

- [ ] **Step 4: Run tests and commit**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

```bash
git add apps/code-agent/src/routes/codeRoutes.ts \
        apps/code-agent/src/domain/repositories/codeTaskRepository.ts \
        apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts
git commit -m "feat(code-agent): add GET /code/queue endpoint (INT-949)"
```

---

### Task 1.13: Run Full CI

- [ ] **Step 1: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: PASS

---

## Subtask 2: Web App — Dispatch Queue View with Real-Time Updates

**Owner:** web app agent
**Service boundary:** `apps/web/`
**Dependencies consumed:**
- Firestore `code_tasks` collection with `status='queued'` field (already exists)
- `GET /code/queue` API endpoint (contract defined above in Shared Types)

### Task 2.1: Add API Function for Queue Endpoint

**Files:**
- Modify: `apps/web/src/services/codeAgentApi.ts`

- [ ] **Step 1: Add getDispatchQueue function**

In `codeAgentApi.ts`, add:

```typescript
export interface QueuedTask {
  id: string;
  prompt: string;
  linearIssueId?: string;
  workerType: string;
  agentType?: string;
  queuedAt: string;
  createdAt: string;
  position: number;
}

export interface QueueResponse {
  tasks: QueuedTask[];
  totalQueued: number;
  maxQueueSize: number;
}

export async function getDispatchQueue(token: string): Promise<QueueResponse> {
  const response = await apiClient.get('/code/queue', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = response.data as { success: boolean; data: QueueResponse };
  return data.data;
}
```

- [ ] **Step 2: Write test for getDispatchQueue**

CLAUDE.md requires tests for `services/` files. Add test in `apps/web/src/services/__tests__/codeAgentApi.test.ts` (or the existing test file for this service):

```typescript
describe('getDispatchQueue', () => {
  it('should call GET /code/queue and return parsed response', async () => {
    // Mock apiClient.get to return a response with tasks array
    // Verify the function returns the data.data unwrapped result
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/codeAgentApi.ts \
        apps/web/src/services/__tests__/codeAgentApi.test.ts
git commit -m "feat(web): add getDispatchQueue API function (INT-949)"
```

---

### Task 2.2: Create useDispatchQueue Hook with Real-Time Firestore Listener

**Files:**
- Create: `apps/web/src/hooks/useDispatchQueue.ts`

This hook provides both:
1. Initial data load via API (for full task details including prompt)
2. Real-time updates via Firestore onSnapshot (for live status changes)

The pattern follows the existing `useCodeTaskLogs.ts` approach.

- [ ] **Step 1: Create the hook**

Create `apps/web/src/hooks/useDispatchQueue.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from 'firebase/firestore';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { getDispatchQueue } from '@/services/codeAgentApi';
import type { QueuedTask, QueueResponse } from '@/services/codeAgentApi';
import {
  authenticateFirebase,
  getFirestoreClient,
  initializeFirebase,
  isFirebaseAuthenticated,
} from '@/services/firebase';

export interface DispatchQueueState {
  tasks: QueuedTask[];
  totalQueued: number;
  maxQueueSize: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDispatchQueue(): DispatchQueueState {
  const { getAccessToken, isAuthenticated, user } = useAuth();
  const [tasks, setTasks] = useState<QueuedTask[]>([]);
  const [totalQueued, setTotalQueued] = useState(0);
  const [maxQueueSize, setMaxQueueSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  const fetchQueue = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessTokenRef.current();
      const data: QueueResponse = await getDispatchQueue(token);
      setTasks(data.tasks);
      setTotalQueued(data.totalQueued);
      setMaxQueueSize(data.maxQueueSize);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load dispatch queue'));
    }
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      await fetchQueue();
      if (!cancelled) {
        setLoading(false);
      }
    };
    void load();
    return (): void => { cancelled = true; };
  }, [fetchQueue]);

  // Firestore real-time listener for queue changes
  useEffect(() => {
    if (!isAuthenticated || user === undefined) return;

    const cancelState = { cancelled: false };
    let unsub: Unsubscribe | null = null;

    const setup = async (): Promise<void> => {
      try {
        if (!isFirebaseAuthenticated()) {
          initializeFirebase();
          const token = await getAccessTokenRef.current();
          if (cancelState.cancelled) return;
          await authenticateFirebase(token);
        }

        const db = getFirestoreClient();
        const queueQuery = query(
          collection(db, 'code_tasks'),
          where('status', '==', 'queued'),
          orderBy('queuedAt', 'asc'),
        );

        unsub = onSnapshot(
          queueQuery,
          () => {
            // On any change to queued tasks, refetch via API for full data
            if (!cancelState.cancelled) {
              void fetchQueue();
            }
          },
          () => {
            // Firestore listener error — silent, API polling still works
          },
        );
      } catch {
        // Firebase init error — page still works via initial API load
      }
    };

    void setup();

    return (): void => {
      cancelState.cancelled = true;
      if (unsub !== null) {
        unsub();
      }
    };
  }, [isAuthenticated, user, fetchQueue]);

  return {
    tasks,
    totalQueued,
    maxQueueSize,
    loading,
    error,
    refresh: fetchQueue,
  };
}
```

- [ ] **Step 2: Write test for useDispatchQueue hook**

CLAUDE.md requires tests for `hooks/` files. Create `apps/web/src/hooks/__tests__/useDispatchQueue.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDispatchQueue } from '../useDispatchQueue.js';

// Mock dependencies
vi.mock('@/services/codeAgentApi', () => ({
  getDispatchQueue: vi.fn(),
}));
vi.mock('@/context', () => ({
  useAuth: () => ({
    getAccessToken: async () => 'test-token',
    isAuthenticated: true,
    user: { sub: 'user-1' },
  }),
}));
vi.mock('@/services/firebase', () => ({
  authenticateFirebase: vi.fn(),
  getFirestoreClient: vi.fn(),
  initializeFirebase: vi.fn(),
  isFirebaseAuthenticated: () => false,
}));

describe('useDispatchQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch queue data on mount', async () => {
    const { getDispatchQueue } = await import('@/services/codeAgentApi');
    (getDispatchQueue as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [{ id: 'task-1', prompt: 'test', position: 1, queuedAt: new Date().toISOString(), createdAt: new Date().toISOString(), workerType: 'auto' }],
      totalQueued: 1,
      maxQueueSize: 10,
    });

    const { result } = renderHook(() => useDispatchQueue());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.totalQueued).toBe(1);
  });

  it('should set error on fetch failure', async () => {
    const { getDispatchQueue } = await import('@/services/codeAgentApi');
    (getDispatchQueue as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useDispatchQueue());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeTruthy();
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useDispatchQueue.ts \
        apps/web/src/hooks/__tests__/useDispatchQueue.test.ts
git commit -m "feat(web): add useDispatchQueue hook with Firestore real-time (INT-949)"
```

---

### Task 2.3: Create DispatchQueuePage Component

**Files:**
- Create: `apps/web/src/pages/DispatchQueuePage.tsx`

The page must be **strictly consistent** with the existing CodeTasksPage styling (same Layout, same card patterns, same colors, same dark mode support).

- [ ] **Step 1: Study CodeTasksPage styling**

Before writing the page, read these files to match the styling patterns:
- `apps/web/src/pages/CodeTasksPage.tsx` — Layout, heading, card structure
- `apps/web/src/components/code-tasks/IssueGroupRow.tsx` — Card component styling
- `apps/web/src/components/Layout.tsx` — Shared layout wrapper

- [ ] **Step 2: Create the page**

Create `apps/web/src/pages/DispatchQueuePage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { ArrowLeft, Clock, Loader2 } from 'lucide-react';
import { Layout } from '@/components';
import { useDispatchQueue } from '@/hooks/useDispatchQueue';

function formatTimeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ago`;
}

function agentTypeLabel(agentType?: string): string {
  switch (agentType) {
    case 'planning': return 'Planning';
    case 'execution': return 'Execution';
    case 'pull_request': return 'PR';
    case 'review': return 'Review';
    default: return 'Auto';
  }
}

export function DispatchQueuePage(): React.JSX.Element {
  const { tasks, totalQueued, maxQueueSize, loading, error } = useDispatchQueue();

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header — matches CodeTasksPage header style */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/code-tasks"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Dispatch Queue
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {totalQueued} / {maxQueueSize} slots used &middot; Tasks dispatched every minute
              </p>
            </div>
          </div>
        </div>

        {/* Error */}
        {error !== null && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}

        {/* Empty state */}
        {!loading && tasks.length === 0 && error === null && (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
            <Clock className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              No tasks in the dispatch queue
            </p>
          </div>
        )}

        {/* Queue list */}
        {!loading && tasks.length > 0 && (
          <div className="space-y-2">
            {tasks.map((task) => (
              <Link
                key={task.id}
                to={`/code-tasks/${task.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {/* Position badge + Linear ID */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        {task.position}
                      </span>
                      {task.linearIssueId !== undefined && (
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {task.linearIssueId}
                        </span>
                      )}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        {agentTypeLabel(task.agentType)}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        {task.workerType}
                      </span>
                    </div>

                    {/* Prompt preview */}
                    <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2">
                      {task.prompt}
                    </p>
                  </div>

                  {/* Time info */}
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Queued {formatTimeAgo(task.queuedAt)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/DispatchQueuePage.tsx
git commit -m "feat(web): add DispatchQueuePage component (INT-949)"
```

---

### Task 2.4: Add Route and Navigation Link

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add import and route**

In `App.tsx`, add the import:

```typescript
import { DispatchQueuePage } from '@/pages/DispatchQueuePage';
```

Add the route after the existing `/code-tasks/pr-events` route:

```tsx
<Route
  path="/code-tasks/dispatch-queue"
  element={
    <ProtectedRoute>
      <DispatchQueuePage />
    </ProtectedRoute>
  }
/>
```

**Important:** Place this route BEFORE the `/code-tasks/:id` catch-all route to avoid the `:id` param matching `dispatch-queue`.

- [ ] **Step 2: Add navigation link from CodeTasksPage**

In `apps/web/src/pages/CodeTasksPage.tsx`, add a "Queue" link button in the header area (near the "New Task" button):

```tsx
<Link
  to="/code-tasks/dispatch-queue"
  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
>
  <Clock className="h-4 w-4" />
  Queue
</Link>
```

Add `Clock` to the lucide-react imports.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/CodeTasksPage.tsx
git commit -m "feat(web): add dispatch queue route and navigation (INT-949)"
```

---

### Task 2.5: Run Full CI

- [ ] **Step 1: Build and verify**

Run: `cd /repo && pnpm run ci:tracked`
Expected: PASS

---

## Important Notes

### `workerLocation` Return Type

After this refactoring, all usecases return `workerLocation: 'queued'` in their success result (since tasks always enter the queue). The `ProcessCodeActionResult`, `RetryTaskResult`, etc. all have `workerLocation: WorkerLocation` (which is `string`). This is backward-compatible — `'queued'` is already a valid `WorkerLocation` string used today for at_capacity scenarios. Downstream route handlers that check `workerLocation` must handle `'queued'` correctly, but they already do (since this was the at_capacity return value before).

### Parallel Execution of Subtasks

Subtask 1 (backend) and Subtask 2 (web) can be coded in parallel because the API contract is fully defined above. However, Subtask 2's `GET /code/queue` API call requires Subtask 1's endpoint to exist at runtime. During development, the Firestore real-time listener provides the core functionality; the API call provides richer data. Both subtasks should be merged before deployment testing.

---

## Migration & Rollout Notes

1. **Backward compatibility:** Existing queued tasks in Firestore will continue to work — `drainTaskQueue` already handles them. The new fields (`planningPrBranch`, `planningPrUrl`, `trackingCommentId`) are optional and backward-compatible.

2. **No data migration needed:** The `code_tasks` collection structure is unchanged except for new optional fields. Old tasks without these fields will dispatch correctly (they'll be `undefined`, same as today).

3. **dispatch_retries collection:** After this change, no new entries will be created in `dispatch_retries` (the createTaskForPR retry logic is removed). The `drainRetryQueue` usecase should be left intact to drain any remaining entries created before deployment. It can be removed in a follow-up cleanup PR.

4. **User-facing change:** Tasks will now always show as "queued" first, even when workers are immediately available. The max wait before dispatch is ~1 minute. Previously, tasks with available workers would dispatch instantly (~2-5 seconds).

5. **Deploy order:** No special deploy order needed. Both old (direct dispatch) and new (queue-only) codepaths produce the same Firestore state (`status='queued'` or `status='dispatched'`), so partial rollouts are safe.
