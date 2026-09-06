/**
 * Tests for the cancelTask use case (INT-1430).
 *
 * Mirrors the test shape of cancelTaskWithNonce.test.ts: each domain error code
 * has a dedicated assertion, the happy path verifies worker
 * side effects, and worker failures are exercised so Firestore never claims a
 * task was cancelled while its worker may still be running.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { cancelTask } from '../../../domain/usecases/cancelTask.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../../domain/services/taskDispatcher.js';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';

describe('cancelTask', () => {
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let workerSettingsRepo: WorkerSettingsRepository;

  const baseTask: CodeTask = {
    id: 'task-123',
    userId: 'user-789',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'Fix the bug',
    systemPromptHash: 'hash-123',
    workerType: 'auto',
    workerLocation: 'home-mac',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-123',
    status: 'running',
    callbackReceived: false,
    dedupKey: 'dedup-key-123',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  } as CodeTask;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    codeTaskRepo = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue(ok(baseTask)),
      findByIdForUser: vi.fn(),
      update: vi.fn().mockResolvedValue(ok({ ...baseTask, status: 'cancelled' })),
      runInTransaction: vi.fn(async (operation) => await operation({} as never)),
    } as unknown as CodeTaskRepository;

    taskDispatcher = {
      dispatch: vi.fn(),
      cancelOnWorker: vi.fn().mockResolvedValue(undefined),
      sendMessageToWorker: vi.fn(),
    } as unknown as TaskDispatcherService;

    workerSettingsRepo = {
      getSettings: vi.fn().mockResolvedValue(
        ok({
          userId: 'user-789',
          workers: [
            {
              name: 'home-mac',
              url: 'https://cc-mac.intexuraos.cloud',
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'signing-secret',
              enabled: true,
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      ),
      getWorkerByName: vi.fn(),
      addWorker: vi.fn(),
      updateWorker: vi.fn(),
      deleteWorker: vi.fn(),
      reorderWorkers: vi.fn(),
      updateTestResult: vi.fn(),
    } as unknown as WorkerSettingsRepository;
  });

  function deps(): Parameters<typeof cancelTask>[0] {
    return { logger, codeTaskRepo, taskDispatcher, workerSettingsRepo };
  }

  it('returns task_not_found when the task does not exist', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(
      err({ code: 'NOT_FOUND', message: 'Task not found' })
    );

    const result = await cancelTask(deps(), { taskId: 'nonexistent', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_found');
    }
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
    expect(taskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
  });

  it('returns not_owner when the requesting user does not own the task', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'different-user' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_owner');
    }
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns task_not_cancellable when task is in a terminal state', async () => {
    const planned = { ...baseTask, status: 'planned' } as CodeTask;
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(planned));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_cancellable');
    }
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns internal_error when the Firestore update fails', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
    );

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
    expect(taskDispatcher.cancelOnWorker).toHaveBeenCalledOnce();
  });

  it('fails closed when atomic repository transactions are unavailable', async () => {
    const repositoryWithoutTransactions = {
      ...codeTaskRepo,
      runInTransaction: undefined,
    } as unknown as CodeTaskRepository;

    const result = await cancelTask(
      { ...deps(), codeTaskRepo: repositoryWithoutTransactions },
      { taskId: 'task-123', userId: 'user-789' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal_error');
    expect(taskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
  });

  it('fails closed on a Firestore read error', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'read failed' }),
    );

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal_error');
    expect(taskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
  });

  it('cancels the task and notifies the worker with credentials', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));

    const result = await cancelTask(deps(), {
      taskId: 'task-123',
      userId: 'user-789',
      traceId: 'trace-xyz',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cancelled).toBe(true);
    }

    expect(codeTaskRepo.update).toHaveBeenCalledWith(
      'task-123',
      { status: 'cancelled' },
      { transaction: expect.any(Object) },
    );
    expect(taskDispatcher.cancelOnWorker).toHaveBeenCalledWith('task-123', 'home-mac', {
      url: 'https://cc-mac.intexuraos.cloud',
      cfAccessClientId: 'client-id',
      cfAccessClientSecret: 'client-secret',
    });
    const updateCallOrder = vi.mocked(codeTaskRepo.update).mock.invocationCallOrder[0];
    if (updateCallOrder === undefined) throw new Error('Expected cancellation update call');
    expect(vi.mocked(taskDispatcher.cancelOnWorker).mock.invocationCallOrder[0]).toBeLessThan(
      updateCallOrder,
    );
  });

  it('cancels queued tasks', async () => {
    const queued = { ...baseTask, status: 'queued' } as CodeTask;
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(queued));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(true);
    expect(codeTaskRepo.update).toHaveBeenCalledWith(
      'task-123',
      { status: 'cancelled' },
      { transaction: expect.any(Object) },
    );
    expect(taskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
  });

  it('returns the cancelled task PR lock for owner-fenced cleanup', async () => {
    const queued = { ...baseTask, status: 'queued', prNumber: 42 } as CodeTask;
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(queued));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({ ...queued, status: 'cancelled' }),
    );

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result).toEqual(ok({
      cancelled: true,
      locksToCleanup: [{ repository: 'pbuchman/intexuraos', prNumber: 42 }],
    }));
  });

  it('cancels dispatched tasks', async () => {
    const dispatched = { ...baseTask, status: 'dispatched' } as CodeTask;
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(dispatched));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(true);
  });

  it('rejects a stale finalization when the dispatch fence changes', async () => {
    const first = { ...baseTask, dispatchToken: 'dispatch-a' } as CodeTask;
    const second = { ...baseTask, dispatchToken: 'dispatch-b' } as CodeTask;
    vi.mocked(codeTaskRepo.findById)
      .mockResolvedValueOnce(ok(first))
      .mockResolvedValueOnce(ok(second));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal_error');
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('does not overwrite a terminal status that wins the cancellation race', async () => {
    vi.mocked(codeTaskRepo.findById)
      .mockResolvedValueOnce(ok(baseTask))
      .mockResolvedValueOnce(ok({ ...baseTask, status: 'implemented' } as CodeTask));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('task_not_cancellable');
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('treats a concurrent cancellation as idempotent', async () => {
    vi.mocked(codeTaskRepo.findById)
      .mockResolvedValueOnce(ok(baseTask))
      .mockResolvedValueOnce(ok({ ...baseTask, status: 'cancelled' } as CodeTask));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(true);
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('cancels atomically if dispatch rolled back to queued while the worker stop was in flight', async () => {
    vi.mocked(codeTaskRepo.findById)
      .mockResolvedValueOnce(ok(baseTask))
      .mockResolvedValueOnce(ok({ ...baseTask, status: 'queued' } as CodeTask));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(true);
    expect(codeTaskRepo.update).toHaveBeenCalledOnce();
  });

  it('keeps the task active when the worker does not confirm cancellation', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));
    vi.mocked(taskDispatcher.cancelOnWorker).mockRejectedValueOnce(new Error('Worker unreachable'));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('uses configured credentials to cancel a running task after the worker is disabled', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));
    vi.mocked(workerSettingsRepo.getSettings).mockResolvedValueOnce(
      ok({
        userId: 'user-789',
        workers: [
          {
            name: 'home-mac',
            url: 'https://cc-mac.intexuraos.cloud',
            cfAccessClientId: 'client-id',
            cfAccessClientSecret: 'client-secret',
            dispatchSigningSecret: 'signing-secret',
            enabled: false,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(true);
    expect(taskDispatcher.cancelOnWorker).toHaveBeenCalledWith(
      'task-123',
      'home-mac',
      {
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'client-id',
        cfAccessClientSecret: 'client-secret',
      },
    );
    expect(codeTaskRepo.update).toHaveBeenCalledOnce();
  });

  it('keeps a running task active when settings are missing', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));
    vi.mocked(workerSettingsRepo.getSettings).mockResolvedValueOnce(ok(null));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
    expect(taskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
  });

  it('keeps a running task active when worker settings cannot be read', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));
    vi.mocked(workerSettingsRepo.getSettings).mockResolvedValueOnce(
      err({ code: 'internal_error', message: 'Settings unavailable' })
    );

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
    expect(taskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
  });

  it('maps a queued cancellation update that loses the task to task_not_found', async () => {
    const queued = { ...baseTask, status: 'queued' } as CodeTask;
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(queued));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      err({ code: 'NOT_FOUND', message: 'task disappeared' }),
    );

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('task_not_found');
    expect(taskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
  });

  it('fails closed if transaction support disappears after worker cancellation preparation', async () => {
    const runTransaction = codeTaskRepo.runInTransaction;
    if (runTransaction === undefined) throw new Error('Expected transactional repository');
    const runTransactionMock = vi.mocked(runTransaction);
    runTransactionMock.mockImplementationOnce(async (operation) => {
      const result = await operation({} as never);
      Object.assign(codeTaskRepo, { runInTransaction: undefined });
      return result;
    });

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal_error');
    expect(taskDispatcher.cancelOnWorker).toHaveBeenCalledOnce();
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns task_not_found if the task disappears after the worker confirms cancellation', async () => {
    vi.mocked(codeTaskRepo.findById)
      .mockResolvedValueOnce(ok(baseTask))
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'task disappeared' }));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('task_not_found');
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('fails closed if the final transactional read fails after worker confirmation', async () => {
    vi.mocked(codeTaskRepo.findById)
      .mockResolvedValueOnce(ok(baseTask))
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'final read failed' }));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal_error');
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('rejects a finalization race that changes task ownership', async () => {
    vi.mocked(codeTaskRepo.findById)
      .mockResolvedValueOnce(ok(baseTask))
      .mockResolvedValueOnce(ok({ ...baseTask, userId: 'different-user' } as CodeTask));

    const result = await cancelTask(deps(), { taskId: 'task-123', userId: 'user-789' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_owner');
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });
});
