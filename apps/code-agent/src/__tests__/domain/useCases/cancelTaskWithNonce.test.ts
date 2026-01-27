/**
 * Tests for cancelTaskWithNonce use case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../../domain/services/taskDispatcher.js';
import type { Logger } from 'pino';
import { cancelTaskWithNonce } from '../../../domain/usecases/cancelTaskWithNonce.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';

describe('cancelTaskWithNonce', () => {
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;

  const baseTask = {
    id: 'task-123',
    userId: 'user-789',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'Fix the bug',
    systemPromptHash: 'hash-123',
    workerType: 'auto' as const,
    workerLocation: 'mac' as const,
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-123',
    status: 'running' as const,
    callbackReceived: false,
    dedupKey: 'dedup-key-123',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    cancelNonce: 'abcd',
    cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    codeTaskRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByIdForUser: vi.fn(),
      update: vi.fn(),
    } as unknown as CodeTaskRepository;

    taskDispatcher = {
      dispatch: vi.fn(),
      cancelOnWorker: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as TaskDispatcherService;
  });

  it('returns task_not_found when task does not exist', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(
      err({ code: 'NOT_FOUND', message: 'Task not found' })
    );

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'nonexistent', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_found');
    }
  });

  it('returns invalid_nonce when nonce does not match', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'wrong', userId: 'user-789' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_nonce');
    }
  });

  it('returns invalid_nonce when task has no nonce', async () => {
    const { cancelNonce: _, cancelNonceExpiresAt: __, ...taskWithoutNonce } = baseTask;
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(taskWithoutNonce as CodeTask));

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_nonce');
    }
  });

  it('returns nonce_expired when nonce has expired', async () => {
    const expiredTask = {
      ...baseTask,
      cancelNonceExpiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(expiredTask));

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('nonce_expired');
    }
  });

  it('returns not_owner when user does not own task', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'different-user' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_owner');
    }
  });

  it('returns task_not_cancellable when task is already completed', async () => {
    const completedTask = { ...baseTask, status: 'completed' as const };
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(completedTask));

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_cancellable');
      expect(result.error.message).toContain('completed');
    }
  });

  it('returns task_not_cancellable when task is failed', async () => {
    const failedTask = { ...baseTask, status: 'failed' as const };
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(failedTask));

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_cancellable');
    }
  });

  it('returns internal_error when update fails', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
    );

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
  });

  it('successfully cancels task with valid nonce', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({ ...baseTask, status: 'cancelled' as const })
    );

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cancelled).toBe(true);
    }

    expect(codeTaskRepo.update).toHaveBeenCalledWith('task-123', {
      status: 'cancelled',
      cancelNonce: null,
      cancelNonceExpiresAt: null,
    });

    expect(taskDispatcher.cancelOnWorker).toHaveBeenCalledWith('task-123', 'mac');
  });

  it('successfully cancels task in dispatched status', async () => {
    const dispatchedTask = { ...baseTask, status: 'dispatched' as const };
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(dispatchedTask));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({ ...dispatchedTask, status: 'cancelled' as const })
    );

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(true);
  });

  it('successfully cancels task when nonce has no expiration time', async () => {
    const { cancelNonceExpiresAt: _, ...taskWithoutExpiry } = baseTask;
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(taskWithoutExpiry));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({ ...taskWithoutExpiry, status: 'cancelled' as const })
    );

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(true);
  });

  it('succeeds even if worker notification fails', async () => {
    vi.mocked(codeTaskRepo.findById).mockResolvedValueOnce(ok(baseTask));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({ ...baseTask, status: 'cancelled' as const })
    );
    vi.mocked(taskDispatcher.cancelOnWorker).mockRejectedValueOnce(new Error('Worker unreachable'));

    const result = await cancelTaskWithNonce(
      { logger, codeTaskRepo, taskDispatcher },
      { taskId: 'task-123', nonce: 'abcd', userId: 'user-789' }
    );

    expect(result.ok).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
});
