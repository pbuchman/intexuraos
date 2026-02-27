# Task Queueing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Firestore-backed task queueing when all workers are at capacity (503), with automatic drain via internal HTTP endpoint and Cloud Scheduler.

**Architecture:** When dispatch fails with 503, tasks enter `queued` status instead of `failed`. A periodic drain mechanism (HTTP endpoint + Cloud Scheduler) fetches the oldest queued task, checks TTL, and dispatches via a dedicated dispatch-only path. Queue is bounded by max size (10) and TTL (30 min).

**Tech Stack:** TypeScript, Fastify, Firestore, Cloud Scheduler (Terraform)

**Linear Issue:** [INT-619](https://linear.app/pbuchman/issue/INT-619/implement-task-queueing-when-workers-are-at-capacity)

---

## Parallel Work Breakdown

This plan is organized for multi-subagent parallel execution. Groups can run concurrently where indicated.

| Group   | Description                                                              | Dependencies         | Parallel?           |
| ------- | ------------------------------------------------------------------------ | -------------------- | ------------------- |
| **A**   | Foundation: Model + Repository + Config                                  | None                 | Start first         |
| **B1**  | Queue Entry: processCodeAction queueing                                  | Group A              | Yes, with B2, B3, C |
| **B2**  | Queue Entry: retryTask queueing                                          | Group A              | Yes, with B1, B3, C |
| **B3**  | Queue Entry: submitToExecutionAgent queueing                             | Group A              | Yes, with B1, B2, C |
| **C**   | Status Handling: sendTaskMessage, cancelTaskWithNonce, detectZombieTasks | Group A              | Yes, with B1-B3     |
| **D**   | Drain Use Case + Route                                                   | Groups A, C          | After A, C          |
| **E**   | Web App Updates                                                          | Group A (types only) | Yes, with B, C, D   |
| **F**   | Migration + Terraform                                                    | After all code       | Sequential at end   |

---

## Group A: Foundation (Model + Repository + Config)

### Task A1: Add `queued` status and `queuedAt` field to CodeTask model

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`

**Step 1: Write the failing test**

Create test file `apps/code-agent/src/__tests__/domain/models/codeTask.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { TaskStatus, CodeTask } from '../../../domain/models/codeTask.js';

describe('CodeTask model', () => {
  it('should include queued as a valid TaskStatus', () => {
    const validStatuses: TaskStatus[] = [
      'dispatched',
      'running',
      'planned',
      'implemented',
      'failed',
      'interrupted',
      'cancelled',
      'queued',
    ];
    expect(validStatuses).toContain('queued');
  });

  it('should allow queuedAt field on CodeTask', () => {
    const task: Partial<CodeTask> = {
      id: 'test-task',
      status: 'queued',
      queuedAt: expect.any(Object), // Timestamp
    };
    expect(task.status).toBe('queued');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run src/__tests__/domain/models/codeTask.test.ts`
Expected: FAIL with TypeScript error - 'queued' is not assignable to type 'TaskStatus'

**Step 3: Implement the model changes**

Edit `apps/code-agent/src/domain/models/codeTask.ts`:

```typescript
// Add 'queued' to TaskStatus union (around line 33-40)
export type TaskStatus =
  | 'dispatched'   // Sent to worker, awaiting start
  | 'running'      // Worker actively processing
  | 'queued'       // Waiting for worker capacity (NEW)
  | 'planned'      // Planning Agent task finished
  | 'implemented'  // Execution Agent task finished
  | 'failed'       // Error occurred
  | 'interrupted'  // Worker died unexpectedly
  | 'cancelled';   // User cancelled

// Add queuedAt field to CodeTask interface (around line 163-166, near dispatchedAt)
export interface CodeTask {
  // ... existing fields ...

  // Timestamps
  createdAt: Timestamp;
  queuedAt?: Timestamp;           // When task entered queue (NEW)
  dispatchedAt?: Timestamp;
  completedAt?: Timestamp;
  updatedAt: Timestamp;

  // ... rest of fields ...
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- --run src/__tests__/domain/models/codeTask.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts apps/code-agent/src/__tests__/domain/models/codeTask.test.ts
git commit -m "feat(code-agent): add queued status and queuedAt field to CodeTask model

Part of INT-619 task queueing implementation.

Designed with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

### Task A2: Add `queue_full` and `queue_timeout` error codes

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts`

**Step 1: Add error codes to ProcessCodeActionErrorCode type**

Edit `apps/code-agent/src/domain/usecases/processCodeAction.ts` (around line 49-57):

```typescript
export type ProcessCodeActionErrorCode =
  | 'unauthorized'
  | 'duplicate_approval'
  | 'duplicate_action'
  | 'duplicate_prompt'
  | 'active_task_exists'
  | 'worker_unavailable'
  | 'worker_not_configured'
  | 'queue_full'          // NEW: Queue at max capacity
  | 'queue_timeout'       // NEW: Task expired in queue
  | 'internal_error';
```

**Step 2: Commit**

```bash
git add apps/code-agent/src/domain/usecases/processCodeAction.ts
git commit -m "feat(code-agent): add queue_full and queue_timeout error codes

Part of INT-619 task queueing implementation.

Designed with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

### Task A3: Add queue configuration to config.ts

**Files:**
- Modify: `apps/code-agent/src/config.ts`

**Step 1: Write the failing test**

Create/update test file for config:

```typescript
import { describe, it, expect } from 'vitest';
import { config } from '../config.js';

describe('config', () => {
  it('should have queue configuration', () => {
    expect(config.queue.maxSize).toBe(10);
    expect(config.queue.ttlMinutes).toBe(30);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run src/__tests__/config.test.ts`
Expected: FAIL - config.queue is undefined

**Step 3: Implement config changes**

Edit `apps/code-agent/src/config.ts`:

```typescript
// Add queue configuration section
export const config = {
  // ... existing config ...

  queue: {
    /** Maximum number of tasks in queue (default 10) */
    maxSize: parseInt(process.env['INTEXURAOS_QUEUE_MAX_SIZE'] ?? '10', 10),
    /** TTL for queued tasks in minutes (default 30) */
    ttlMinutes: parseInt(process.env['INTEXURAOS_QUEUE_TTL_MINUTES'] ?? '30', 10),
  },
} as const;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- --run src/__tests__/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/code-agent/src/config.ts apps/code-agent/src/__tests__/config.test.ts
git commit -m "feat(code-agent): add queue configuration (maxSize, ttlMinutes)

Part of INT-619 task queueing implementation.

Designed with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

### Task A4: Add repository methods for queue operations

**Files:**
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`

**Step 1: Add port definitions**

Edit `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`:

```typescript
export interface CodeTaskRepository {
  // ... existing methods ...

  /** Find oldest queued task for drain */
  findOldestQueued(): Promise<Result<CodeTask | null, RepositoryError>>;

  /** Count currently queued tasks */
  countQueued(): Promise<Result<number, RepositoryError>>;
}
```

**Step 2: Write failing tests for new methods**

```typescript
describe('firestoreCodeTaskRepository queue methods', () => {
  it('findOldestQueued returns oldest queued task', async () => {
    // Setup: create 2 queued tasks with different createdAt
    // Assert: returns the older one
  });

  it('findOldestQueued returns null when no queued tasks', async () => {
    const result = await repo.findOldestQueued();
    expect(result.ok).toBe(true);
    expect(result.value).toBeNull();
  });

  it('countQueued returns count of queued tasks', async () => {
    // Setup: create 3 queued tasks
    const result = await repo.countQueued();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(3);
  });
});
```

**Step 3: Implement repository methods**

Edit `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`:

```typescript
findOldestQueued: async (): Promise<Result<CodeTask | null, RepositoryError>> => {
  try {
    const snapshot = await collection
      .where('status', '==', 'queued')
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return ok(null);
    }

    const doc = snapshot.docs[0]!;
    const data = doc.data();
    const task: CodeTask = {
      ...data,
      id: doc.id,
      createdAt: data['createdAt'],
      updatedAt: data['updatedAt'],
    } as CodeTask;

    return ok(task);
  } catch (error) {
    logger.error({ error }, 'Failed to find oldest queued task');
    return err({
      code: 'FIRESTORE_ERROR',
      message: `Firestore error: ${getErrorMessage(error)}`,
    });
  }
},

countQueued: async (): Promise<Result<number, RepositoryError>> => {
  try {
    const snapshot = await collection
      .where('status', '==', 'queued')
      .get();
    return ok(snapshot.size);
  } catch (error) {
    logger.error({ error }, 'Failed to count queued tasks');
    return err({
      code: 'FIRESTORE_ERROR',
      message: `Firestore error: ${getErrorMessage(error)}`,
    });
  }
},
```

**Step 4: Fix phantom `pending` status bug (line 491)**

While in `firestoreCodeTaskRepository.ts`, fix the pre-existing bug:

```typescript
// Line 491: Change 'pending' to 'queued'
hasActiveTaskForLinearIssue: async (
  linearIssueId: string
): Promise<Result<{ hasActive: boolean; taskId?: string }, RepositoryError>> => {
  try {
    // FIXED: Replace phantom 'pending' with 'queued'
    const activeStatuses = ['queued', 'dispatched', 'running'] as const;
    // ... rest unchanged
  }
}
```

**Step 5: Update Layer 3 dedup to include `queued`**

```typescript
// Around line 136-142, update active statuses for dedup
// Layer 3: Check active task for Linear issue
if (input.linearIssueId !== undefined) {
  const activeStatuses = ['queued', 'dispatched', 'running'] as const;  // Added 'queued'
  // ... rest unchanged
}
```

**Step 6: Run tests and commit**

```bash
pnpm --filter code-agent test
git add apps/code-agent/src/domain/repositories/codeTaskRepository.ts apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts
git commit -m "feat(code-agent): add queue repository methods and fix phantom pending status

- Add findOldestQueued() and countQueued() methods
- Fix hasActiveTaskForLinearIssue phantom 'pending' → 'queued'
- Add 'queued' to Layer 3 dedup active statuses

Part of INT-619 task queueing implementation.

Designed with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

## Group B1: Queue Entry - processCodeAction

### Task B1.1: Implement queueing on 503 in processCodeAction

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts`
- Modify: `apps/code-agent/src/__tests__/usecases/processCodeAction.test.ts`

**Step 1: Write failing test**

```typescript
it('queues task instead of failing when all workers return 503', async () => {
  // Setup: mock taskDispatcher.dispatch to return at_capacity error
  mockTaskDispatcher.dispatch.mockResolvedValue(
    err({ code: 'at_capacity', message: 'All workers busy' })
  );
  mockCodeTaskRepo.countQueued.mockResolvedValue(ok(5)); // Under max

  const result = await processCodeAction(deps, request);

  expect(result.ok).toBe(true);
  expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ status: 'queued' })
  );
});

it('returns queue_full when queue at max capacity', async () => {
  mockTaskDispatcher.dispatch.mockResolvedValue(
    err({ code: 'at_capacity', message: 'All workers busy' })
  );
  mockCodeTaskRepo.countQueued.mockResolvedValue(ok(10)); // At max

  const result = await processCodeAction(deps, request);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('queue_full');
  }
});
```

**Step 2: Implement queueing logic**

Replace the dispatch error handling (lines 312-327) with:

```typescript
if (!dispatchResult.ok) {
  const dispatchError = dispatchResult.error;

  // Check if this is an at_capacity error (503)
  if (dispatchError.code === 'at_capacity') {
    // Check queue capacity
    const queueCountResult = await codeTaskRepo.countQueued();
    const queueCount = queueCountResult.ok ? queueCountResult.value : 0;

    if (queueCount >= config.queue.maxSize) {
      // Queue is full - fail explicitly
      await codeTaskRepo.update(task.id, {
        status: 'failed',
        error: {
          code: 'queue_full',
          message: `All workers are busy and the queue is full (${queueCount}/${config.queue.maxSize}). Please try again in a few minutes.`,
        },
      });
      return err({
        code: 'queue_full',
        message: `All workers are busy and the queue is full. Please try again in a few minutes.`,
      });
    }

    // Queue the task
    const queuedAt = new Date();
    await codeTaskRepo.update(task.id, {
      status: 'queued',
      queuedAt,
    });

    // Send WhatsApp notification about queue entry
    const queuePosition = queueCount + 1;
    const estimatedWaitMinutes = queuePosition * 5; // Rough estimate
    await whatsappNotifier.notifyTaskQueued(userId, task, queuePosition, estimatedWaitMinutes);

    logger.info({ taskId: task.id, queuePosition }, 'Task queued due to worker capacity');

    return ok({
      codeTaskId: task.id,
      resourceUrl: `/#/code-tasks/${task.id}`,
      workerLocation: enabledWorkers[0]?.name ?? 'unknown',
    });
  }

  // Other dispatch errors - fail as before
  await codeTaskRepo.update(task.id, {
    status: 'failed',
    error: {
      code: dispatchError.code,
      message: dispatchError.message,
    },
  });

  return err({
    code: 'worker_unavailable',
    message: dispatchError.message,
  });
}
```

**Step 3: Run tests and commit**

```bash
pnpm --filter code-agent test
git add apps/code-agent/src/domain/usecases/processCodeAction.ts apps/code-agent/src/__tests__/usecases/processCodeAction.test.ts
git commit -m "feat(code-agent): queue tasks on 503 instead of failing in processCodeAction

- Check queue capacity before queueing
- Return queue_full when queue at max capacity
- Send WhatsApp notification on queue entry

Part of INT-619 task queueing implementation.

Designed with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
```

---

## Group B2: Queue Entry - retryTask

### Task B2.1: Implement queueing on 503 in retryTask

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts`
- Modify: `apps/code-agent/src/__tests__/usecases/retryTask.test.ts`

Same pattern as B1.1, applied to retryTask.ts dispatch error handling (lines 353-385).

---

## Group B3: Queue Entry - submitToExecutionAgent

### Task B3.1: Implement queueing on 503 in submitToExecutionAgent

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts`

Same pattern as B1.1, applied to submitToExecutionAgent.ts dispatch error handling (lines 375-416).

---

## Group C: Status Handling Updates

### Task C1: Reject `queued` status in sendTaskMessage

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/sendTaskMessage.ts`

**Step 1: Write failing test**

```typescript
it('rejects queued status with invalid_status error', async () => {
  mockCodeTaskRepo.findByIdForUser.mockResolvedValue(
    ok({ ...mockTask, status: 'queued' })
  );

  const result = await sendTaskMessage(deps, request);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('invalid_status');
  }
});
```

**Step 2: Update status check (line 69)**

```typescript
// Add 'queued' to rejected statuses
if (task.status === 'cancelled' || task.status === 'dispatched' || task.status === 'queued') {
  logger.warn({ taskId, status: task.status }, 'Cannot send message to task with this status');
  return err({
    code: 'invalid_status',
    message: `Cannot send message to task with status "${task.status}"`,
  });
}
```

---

### Task C2: Add `queued` to cancellable statuses in cancelTaskWithNonce

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/cancelTaskWithNonce.ts`

**Step 1: Write failing test**

```typescript
it('allows cancelling queued tasks', async () => {
  mockCodeTaskRepo.findById.mockResolvedValue(
    ok({ ...mockTask, status: 'queued', cancelNonce: 'abc1', userId: 'user-1' })
  );

  const result = await cancelTaskWithNonce(deps, { taskId: 'task-1', nonce: 'abc1', userId: 'user-1' });

  expect(result.ok).toBe(true);
});
```

**Step 2: Update cancellable statuses (line 90)**

```typescript
// Add 'queued' to cancellable statuses
const cancellableStatuses = ['dispatched', 'running', 'queued'];
```

---

### Task C3: Include `queued` in zombie detection

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/detectZombieTasks.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`

**Step 1: Update findZombieTasks query**

In `firestoreCodeTaskRepository.ts` (around line 516-521):

```typescript
findZombieTasks: async (staleThreshold: Date): Promise<Result<CodeTask[], RepositoryError>> => {
  try {
    const snapshot = await collection
      .where('status', 'in', ['running', 'dispatched', 'queued'])  // Added 'queued'
      .where('updatedAt', '<', Timestamp.fromDate(staleThreshold))
      .get();
    // ... rest unchanged
  }
}
```

---

## Group D: Drain Use Case + Route

### Task D1: Create drainTaskQueue use case

**Files:**
- Create: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- Create: `apps/code-agent/src/__tests__/usecases/drainTaskQueue.test.ts`

**Step 1: Create the use case file**

```typescript
/**
 * Use case: Drain task queue by dispatching oldest queued task.
 *
 * Called by Cloud Scheduler via POST /internal/drain-queue.
 * Uses dedicated dispatch-only path (not processCodeAction) to avoid dedup rejection.
 *
 * INT-619: Task queueing when workers are at capacity.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../services/taskDispatcher.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import { config } from '../../config.js';
import { generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';

// In-memory guard for single-instance environments
let isDraining = false;

export interface DrainTaskQueueResult {
  action: 'dispatched' | 'expired' | 'still_busy' | 'empty' | 'skipped';
  taskId?: string;
}

export interface DrainTaskQueueError {
  code: 'internal_error' | 'concurrent_drain';
  message: string;
}

export interface DrainTaskQueueDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskDispatcher: TaskDispatcherService;
  linearAgentClient: LinearAgentClient;
  whatsappNotifier: WhatsAppNotifier;
  workerSettingsRepo: WorkerSettingsRepository;
  serviceUrl: string;
}

export async function drainTaskQueue(
  deps: DrainTaskQueueDeps
): Promise<Result<DrainTaskQueueResult, DrainTaskQueueError>> {
  const { logger, codeTaskRepo, taskDispatcher, linearAgentClient, whatsappNotifier, workerSettingsRepo } = deps;

  // Fast-path guard for single-instance
  if (isDraining) {
    logger.info('Drain already in progress, skipping');
    return ok({ action: 'skipped' });
  }

  isDraining = true;
  try {
    // Step 1: Find oldest queued task
    const findResult = await codeTaskRepo.findOldestQueued();
    if (!findResult.ok) {
      logger.error({ error: findResult.error }, 'Failed to find oldest queued task');
      return err({ code: 'internal_error', message: findResult.error.message });
    }

    const task = findResult.value;
    if (task === null) {
      logger.info('No queued tasks to drain');
      return ok({ action: 'empty' });
    }

    logger.info({ taskId: task.id }, 'Processing queued task');

    // Step 2: Check TTL
    const queuedAt = task.queuedAt?.toDate() ?? task.createdAt.toDate();
    const ttlMs = config.queue.ttlMinutes * 60 * 1000;
    const now = Date.now();

    if (now - queuedAt.getTime() > ttlMs) {
      // Task expired - mark as failed
      logger.warn({ taskId: task.id, queuedAt }, 'Queued task expired');
      await codeTaskRepo.update(task.id, {
        status: 'failed',
        error: {
          code: 'queue_timeout',
          message: `Task expired in queue after ${config.queue.ttlMinutes} minutes. Workers were still busy.`,
        },
      });

      // Send WhatsApp notification
      await whatsappNotifier.notifyTaskQueueExpired(task.userId, task);

      return ok({ action: 'expired', taskId: task.id });
    }

    // Step 3: Fetch user's CURRENT worker settings (may have changed since queue)
    const settingsResult = await workerSettingsRepo.getSettings(task.userId);
    if (!settingsResult.ok || settingsResult.value === null) {
      logger.error({ userId: task.userId }, 'Failed to fetch worker settings for drain');
      return err({ code: 'internal_error', message: 'Failed to fetch worker settings' });
    }

    const settings = settingsResult.value;
    const enabledWorkers = settings.workers.filter((w) => w.enabled);

    if (enabledWorkers.length === 0) {
      logger.warn({ userId: task.userId }, 'User has no enabled workers during drain');
      // Leave queued for next cycle - user might re-enable workers
      return ok({ action: 'still_busy', taskId: task.id });
    }

    const workerCredentials: DispatchWorkerCredentials = {
      workers: enabledWorkers.map((w) => ({
        name: w.name,
        url: w.url,
        cfAccessClientId: w.cfAccessClientId,
        cfAccessClientSecret: w.cfAccessClientSecret,
        dispatchSigningSecret: w.dispatchSigningSecret,
      })),
    };

    // Step 4: Fetch FRESH Linear issue metadata (labels may have changed)
    let linearIssueLabels: string[] = [];
    let hasChildren = false;

    if (task.linearIssueId !== undefined) {
      const validateResult = await linearAgentClient.validateIssue({
        userId: task.userId,
        identifier: task.linearIssueId,
      });

      if (validateResult.ok) {
        linearIssueLabels = validateResult.value.labels;
        hasChildren = validateResult.value.childCount > 0;
      } else {
        logger.warn({ linearIssueId: task.linearIssueId }, 'Failed to refresh Linear labels during drain');
      }
    }

    // Step 5: Attempt dispatch (using stored webhookSecret from initial creation)
    const webhookUrl = `${deps.serviceUrl}/internal/webhooks/task-complete`;

    const dispatchRequest = {
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
      linearIssueLabels,
      hasChildren,
      agentType: task.agentType ?? 'planning',
      ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    };

    const dispatchResult = await taskDispatcher.dispatch(dispatchRequest);

    if (!dispatchResult.ok) {
      // Still at capacity - leave queued for next cycle
      logger.info({ taskId: task.id, error: dispatchResult.error }, 'Workers still busy, task remains queued');
      return ok({ action: 'still_busy', taskId: task.id });
    }

    // Step 6: Success - update status to dispatched
    const cancelNonce = generateCancelNonce();
    const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

    const updateResult = await codeTaskRepo.update(task.id, {
      status: 'dispatched',
      workerLocation: dispatchResult.value.workerLocation,
      cancelNonce,
      cancelNonceExpiresAt,
    });

    if (updateResult.ok) {
      // Send "task started" WhatsApp notification
      await whatsappNotifier.notifyTaskStarted(task.userId, updateResult.value);
    }

    logger.info({ taskId: task.id, workerLocation: dispatchResult.value.workerLocation }, 'Queued task dispatched');
    return ok({ action: 'dispatched', taskId: task.id });

  } finally {
    isDraining = false;
  }
}
```

**Step 2: Write comprehensive tests**

Tests should cover:
- Empty queue → returns `{ action: 'empty' }`
- TTL expired → marks failed with `queue_timeout`, sends WhatsApp notification
- Workers still busy (503) → returns `{ action: 'still_busy' }`
- Successful dispatch → updates to `dispatched`, sends WhatsApp notification
- Concurrent drain → second call returns `{ action: 'skipped' }`
- Fresh Linear labels fetched at drain time

---

### Task D2: Add POST /internal/drain-queue endpoint

**Files:**
- Modify: `apps/code-agent/src/routes/internalRoutes.ts`

**Step 1: Add route**

```typescript
// POST /internal/drain-queue - triggered by Cloud Scheduler
fastify.post<{ Reply: DrainQueueResponse }>(
  '/internal/drain-queue',
  {
    preHandler: validateInternalAuth,
  },
  async (request, reply) => {
    logIncomingRequest(request, logger);

    const result = await drainTaskQueue({
      logger,
      codeTaskRepo: getServices().codeTaskRepo,
      taskDispatcher: getServices().taskDispatcher,
      linearAgentClient: getServices().linearAgentClient,
      whatsappNotifier: getServices().whatsappNotifier,
      workerSettingsRepo: getServices().workerSettingsRepo,
      serviceUrl: config.serviceUrl,
    });

    if (!result.ok) {
      logger.error({ error: result.error }, 'Drain queue failed');
      return reply.fail(500, result.error.message);
    }

    return reply.ok(result.value);
  }
);
```

---

## Group E: Web App Updates

### Task E1: Add `queued` to CodeTaskStatus type

**Files:**
- Modify: `apps/web/src/types/index.ts`

**Step 1: Update type definition (lines 1105-1112)**

```typescript
export type CodeTaskStatus =
  | 'dispatched'
  | 'running'
  | 'queued'      // NEW
  | 'planned'
  | 'implemented'
  | 'failed'
  | 'interrupted'
  | 'cancelled';
```

---

### Task E2: Add `queued` to STATUS_STYLES in CodeTasksPage

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`

**Step 1: Update ALL_TASK_STATUSES (line 36-38)**

```typescript
const ALL_TASK_STATUSES: CodeTaskStatus[] = [
  'dispatched', 'running', 'queued', 'planned', 'implemented', 'failed', 'interrupted', 'cancelled',
];
```

**Step 2: Add queued style to STATUS_STYLES (lines 40-48)**

```typescript
const STATUS_STYLES: Record<CodeTaskStatus, StatusStyle> = {
  dispatched: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-800 dark:text-slate-300', label: 'Dispatched' },
  running: { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-800 dark:text-blue-300', label: 'Running' },
  queued: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-300', label: 'Queued' },  // NEW
  planned: { bg: 'bg-violet-100 dark:bg-violet-900/50', text: 'text-violet-800 dark:text-violet-300', label: 'Planned' },
  implemented: { bg: 'bg-green-100 dark:bg-green-900/50', text: 'text-green-800 dark:text-green-300', label: 'Implemented' },
  failed: { bg: 'bg-red-100 dark:bg-red-900/50', text: 'text-red-800 dark:text-red-300', label: 'Failed' },
  interrupted: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-300', label: 'Interrupted' },
  cancelled: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400', label: 'Cancelled' },
};
```

---

### Task E3: Add `queued` to STATUS_MAP and isActiveStatus in CodeTaskViewPage

**Files:**
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx`

Update STATUS_MAP and isActiveStatus check to include `queued`.

---

## Group F: Migration + Terraform

### Task F1: Create Firestore composite index migration

**Files:**
- Create: `migrations/051_code-tasks-status-createdat-index.mjs`

```javascript
/**
 * Migration: Add composite index for queued task queries
 *
 * Required for drainTaskQueue query:
 *   .where('status', '==', 'queued')
 *   .orderBy('createdAt', 'asc')
 *
 * INT-619: Task queueing implementation
 */

export const meta = {
  description: 'Add composite index for code_tasks (status, createdAt) for queue drain queries',
  version: '051',
};

export async function up(firestore, logger) {
  // Composite indexes are defined in firestore.indexes.json
  // This migration documents the requirement
  logger.info('Index (status, createdAt ASC) required for code_tasks collection');
  logger.info('Ensure firestore.indexes.json includes this index');

  return { success: true, message: 'Index documented' };
}

export async function down(firestore, logger) {
  logger.info('Index removal must be done manually via Firebase console');
  return { success: true, message: 'Manual removal required' };
}
```

Also update `firestore.indexes.json`:

```json
{
  "collectionGroup": "code_tasks",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "ASCENDING" }
  ]
}
```

---

### Task F2: Add Cloud Scheduler Terraform configuration

**Files:**
- Modify: `terraform/environments/dev/main.tf`

```hcl
# Cloud Scheduler job for task queue drain
resource "google_cloud_scheduler_job" "drain_task_queue" {
  name             = "drain-task-queue"
  description      = "Trigger task queue drain every 30 seconds"
  schedule         = "*/1 * * * *"  # Every minute (Cloud Scheduler minimum)
  time_zone        = "UTC"
  attempt_deadline = "60s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_service.code_agent.status[0].url}/internal/drain-queue"

    headers = {
      "X-Internal-Auth" = var.internal_auth_token
    }
  }

  retry_config {
    retry_count = 0  # Don't retry - next scheduled run will handle it
  }
}
```

---

## WhatsApp Notifier Methods (Referenced Throughout)

Add these methods to `WhatsAppNotifier` interface and implementation:

```typescript
interface WhatsAppNotifier {
  // ... existing methods ...

  notifyTaskQueued(userId: string, task: CodeTask, position: number, estimatedWaitMinutes: number): Promise<Result<void, Error>>;
  notifyTaskQueueExpired(userId: string, task: CodeTask): Promise<Result<void, Error>>;
}
```

Implementation in `whatsappNotifierImpl.ts`:

```typescript
notifyTaskQueued: async (userId, task, position, estimatedWaitMinutes) => {
  const message = `🕐 Your task has been queued. Workers are busy.\n\nPosition: ${position} of ${config.queue.maxSize}\nEstimated wait: ~${estimatedWaitMinutes} minutes\n\nTask: ${task.linearIssueTitle ?? task.id}`;
  return sendMessage(userId, message);
},

notifyTaskQueueExpired: async (userId, task) => {
  const message = `⏰ Your task expired in the queue after ${config.queue.ttlMinutes} minutes.\n\nWorkers were still busy. Please retry.\n\nTask: ${task.linearIssueTitle ?? task.id}`;
  return sendMessage(userId, message);
},
```

---

## Final Verification

After completing all tasks:

1. Run full CI: `pnpm run ci:tracked`
2. Verify all tests pass with 95%+ coverage
3. Verify Terraform plan: `terraform plan`
4. Deploy to dev and test manually:
   - Submit task when all workers busy → verify queued status
   - Wait for drain → verify dispatch
   - Test TTL expiry → verify failure notification

---

## Summary

| Group     | Tasks                       | Est. Time      |
| --------- | --------------------------- | -------------- |
| A         | 4 tasks                     | 2 hours        |
| B1-B3     | 3 tasks (parallel)          | 1.5 hours      |
| C         | 3 tasks (parallel with B)   | 1 hour         |
| D         | 2 tasks                     | 2 hours        |
| E         | 3 tasks (parallel with B-D) | 1 hour         |
| F         | 2 tasks                     | 1 hour         |
| **Total** | **17 tasks**                | **~8.5 hours** |
