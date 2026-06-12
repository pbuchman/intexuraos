/**
 * Tests for TaskEnqueueServiceImpl.
 *
 * INT-949: Unified task enqueue service.
 *
 * Test Requirements:
 * 1. Successful enqueue — returns queue position
 * 2. Queue full — returns queue_full error and marks task as failed
 * 3. Task not found — returns task_not_found error
 * 4. Sets queuedAt timestamp on the task
 * 5. countQueued failure returns internal_error
 * 6. update failure returns internal_error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { RepositoryError } from '../../../domain/repositories/codeTaskRepository.js';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';
import { TaskEnqueueServiceImpl } from '../../../infra/services/taskEnqueueServiceImpl.js';

// Mock config
vi.mock('../../../config.js', () => ({
  loadConfig: (): {
    queue: { maxSize: number; ttlMinutes: number };
    autoRetry: { maxAttempts: number };
  } => ({
    queue: { maxSize: 50, ttlMinutes: 1440 },
    autoRetry: { maxAttempts: 3 },
  }),
}));

describe('TaskEnqueueServiceImpl', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findById: ReturnType<typeof vi.fn>;
    countQueued: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockWhatsappNotifier: {
    notifyTaskDispatchBlocked: ReturnType<typeof vi.fn>;
  };

  function createMockTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    return {
      id: 'task-123',
      userId: 'user-456',
      traceId: 'trace-789',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'hash-abc',
      workerType: 'opus',
      workerLocation: 'home-mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'queued',
      callbackReceived: false,
      dedupKey: 'dedup-xyz',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    mockCodeTaskRepo = {
      findById: vi.fn(),
      countQueued: vi.fn(),
      update: vi.fn(),
    };
    mockWhatsappNotifier = {
      notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createService(): TaskEnqueueServiceImpl {
    return new TaskEnqueueServiceImpl({
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as never,
      whatsappNotifier: mockWhatsappNotifier as never as WhatsAppNotifier,
    });
  }

  it('returns queue position on successful enqueue', async () => {
    const task = createMockTask();
    const updatedTask = createMockTask({ queuedAt: Timestamp.now() });
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(3));
    mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));

    const service = createService();
    const result = await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskId).toBe('task-123');
      expect(result.value.queuePosition).toBe(3); // countQueued already includes self (INT-977)
    }
  });

  it('returns task_not_found error when task does not exist', async () => {
    const repoError: RepositoryError = { code: 'NOT_FOUND', message: 'Task not found' };
    mockCodeTaskRepo.findById.mockResolvedValue(err(repoError));

    const service = createService();
    const result = await service.enqueue({ taskId: 'missing-task', userId: 'user-456' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_found');
      expect(result.error.message).toContain('missing-task');
    }
  });

  it('returns queue_full error, marks task failed with dispatch status, and notifies when queue reaches maxSize', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(50)); // >= maxSize of 50
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const service = createService();
    const result = await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('queue_full');
    }

    // Verify task was marked as failed
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'dispatch_blocked_queue_full' }),
      dispatchStatus: expect.objectContaining({
        state: 'terminal',
        reason: 'queue_full',
        terminal: true,
        nextAction: 'retry_after_fix',
      }),
    }));
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      workerType: 'opus',
      reason: 'queue_full',
      affectedTaskCount: 1,
      exampleTaskId: 'task-123',
    }));
    expect(mockCodeTaskRepo.update).toHaveBeenCalledTimes(1);
    expect(mockCodeTaskRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockWhatsappNotifier.notifyTaskDispatchBlocked.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('returns internal_error and does not notify when queue-full task failure persistence fails', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(50));
    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'write failed' } satisfies RepositoryError),
    );

    const service = createService();
    const result = await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('sets queuedAt timestamp on the task', async () => {
    const task = createMockTask();
    const updatedTask = createMockTask({ queuedAt: Timestamp.now() });
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(2));
    mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));

    const service = createService();
    await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
      queuedAt: expect.any(Date),
    }));
  });

  it('uses caller-provided queuedAt override when present (Fix D)', async () => {
    const task = createMockTask();
    const updatedTask = createMockTask({ queuedAt: Timestamp.now() });
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(2));
    mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));

    const overrideQueuedAt = new Date('2026-04-25T10:00:00.000Z');
    const service = createService();
    await service.enqueue({
      taskId: 'task-123',
      userId: 'user-456',
      queuedAt: overrideQueuedAt,
    });

    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', { queuedAt: overrideQueuedAt });
  });

  it('defaults to current time when no queuedAt override is provided (Fix D)', async () => {
    const task = createMockTask();
    const updatedTask = createMockTask({ queuedAt: Timestamp.now() });
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(2));
    mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));

    const before = Date.now();
    const service = createService();
    await service.enqueue({ taskId: 'task-123', userId: 'user-456' });
    const after = Date.now();

    expect(mockCodeTaskRepo.update).toHaveBeenCalledOnce();
    const updateArgs = mockCodeTaskRepo.update.mock.calls[0]?.[1] as { queuedAt: Date };
    expect(updateArgs.queuedAt).toBeInstanceOf(Date);
    const stamped = updateArgs.queuedAt.getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
  });

  it('returns internal_error when countQueued fails', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'connection lost' } satisfies RepositoryError),
    );

    const service = createService();
    const result = await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
  });

  it('returns internal_error when update fails', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(2));
    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'write failed' } satisfies RepositoryError),
    );

    const service = createService();
    const result = await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
  });

  it('returns queuePosition without estimatedWaitMinutes', async () => {
    const task = createMockTask();
    const updatedTask = createMockTask({ queuedAt: Timestamp.now() });
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(9));
    mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));

    const service = createService();
    const result = await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queuePosition).toBe(9); // countQueued already includes self (INT-977)
      expect(result.value).not.toHaveProperty('estimatedWaitMinutes');
    }
  });

  describe('enqueueMany', () => {
    it('returns empty result for an empty batch', async () => {
      const service = createService();
      const result = await service.enqueueMany({ taskIds: [], userId: 'user-456' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
      expect(mockCodeTaskRepo.findById).not.toHaveBeenCalled();
    });

    it('returns task_not_found when a batch task lookup fails', async () => {
      mockCodeTaskRepo.findById.mockResolvedValueOnce(
        err({ code: 'NOT_FOUND', message: 'missing task' } satisfies RepositoryError),
      );

      const service = createService();
      const result = await service.enqueueMany({ taskIds: ['missing-task'], userId: 'user-456' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task_not_found');
      }
    });

    it('returns internal_error when queue count fails for batch enqueue', async () => {
      mockCodeTaskRepo.findById.mockResolvedValue(ok(createMockTask()));
      mockCodeTaskRepo.countQueued.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'count failed' } satisfies RepositoryError),
      );

      const service = createService();
      const result = await service.enqueueMany({ taskIds: ['task-123'], userId: 'user-456' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
    });

    it('marks all batch tasks failed with dispatch status and notifies each task when the queue is already full', async () => {
      mockCodeTaskRepo.findById
        .mockResolvedValueOnce(ok(createMockTask({ id: 'task-1' })))
        .mockResolvedValueOnce(ok(createMockTask({ id: 'task-2' })));
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(50));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'failed' })));

      const service = createService();
      const result = await service.enqueueMany({ taskIds: ['task-1', 'task-2'], userId: 'user-456' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
      }
      expect(mockCodeTaskRepo.update).toHaveBeenCalledTimes(2);
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({ code: 'dispatch_blocked_queue_full' }),
          dispatchStatus: expect.objectContaining({
            reason: 'queue_full',
          }),
        }),
      );
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'task-2',
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({ code: 'dispatch_blocked_queue_full' }),
          dispatchStatus: expect.objectContaining({
            reason: 'queue_full',
          }),
        }),
      );
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledTimes(2);
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenNthCalledWith(1, 'user-456', expect.objectContaining({
        reason: 'queue_full',
        affectedTaskCount: 2,
        exampleTaskId: 'task-1',
      }));
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenNthCalledWith(2, 'user-456', expect.objectContaining({
        reason: 'queue_full',
        affectedTaskCount: 2,
        exampleTaskId: 'task-2',
      }));
    });

    it('returns internal_error and stops batch queue-full handling when task failure persistence fails', async () => {
      mockCodeTaskRepo.findById
        .mockResolvedValueOnce(ok(createMockTask({ id: 'task-1' })))
        .mockResolvedValueOnce(ok(createMockTask({ id: 'task-2' })));
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(50));
      mockCodeTaskRepo.update.mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'write failed' } satisfies RepositoryError),
      );

      const service = createService();
      const result = await service.enqueueMany({ taskIds: ['task-1', 'task-2'], userId: 'user-456' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
      expect(mockCodeTaskRepo.update).toHaveBeenCalledTimes(1);
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
    });

    it('logs a warning and keeps original task when queuedAt update fails during batch enqueue', async () => {
      const task = createMockTask({ id: 'task-1' });
      mockCodeTaskRepo.findById.mockResolvedValueOnce(ok(task));
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(1));
      mockCodeTaskRepo.update.mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'update failed' } satisfies RepositoryError),
      );

      const service = createService();
      const result = await service.enqueueMany({ taskIds: ['task-1'], userId: 'user-456' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([{ taskId: 'task-1', queuePosition: 1 }]);
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1', error: { code: 'FIRESTORE_ERROR', message: 'update failed' } }),
        'Failed to update task with queuedAt during batch enqueue',
      );
    });

    it('succeeds when batch enqueue update succeeds', async () => {
      const task = createMockTask({ id: 'task-1' });
      const updatedTask = createMockTask({ id: 'task-1', queuedAt: Timestamp.now() });
      mockCodeTaskRepo.findById.mockResolvedValueOnce(ok(task));
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(1));
      mockCodeTaskRepo.update.mockResolvedValueOnce(ok(updatedTask));

      const service = createService();
      const result = await service.enqueueMany({ taskIds: ['task-1'], userId: 'user-456' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([{ taskId: 'task-1', queuePosition: 1 }]);
      }
    });
  });
});
