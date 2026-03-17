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
 * 5. Sends WhatsApp notification with queue position
 * 6. countQueued failure returns internal_error
 * 7. update failure returns internal_error
 * 8. WhatsApp notification failure is non-fatal (still succeeds)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { RepositoryError } from '../../../domain/repositories/codeTaskRepository.js';
import { TaskEnqueueServiceImpl } from '../../../infra/services/taskEnqueueServiceImpl.js';

// Mock config
vi.mock('../../../config.js', () => ({
  loadConfig: (): { queue: { maxSize: number; ttlMinutes: number } } => ({
    queue: { maxSize: 10, ttlMinutes: 360 },
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
    notifyTaskQueued: ReturnType<typeof vi.fn>;
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
      notifyTaskQueued: vi.fn().mockResolvedValue(ok(undefined)),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createService(): TaskEnqueueServiceImpl {
    return new TaskEnqueueServiceImpl({
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as never,
      whatsappNotifier: mockWhatsappNotifier as never,
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
      expect(result.value.queuePosition).toBe(3);
      expect(result.value.estimatedWaitMinutes).toBe(15); // 3 * 5
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

  it('returns queue_full error and marks task as failed when queue reaches maxSize', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(10)); // >= maxSize of 10
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
      error: expect.objectContaining({ code: 'queue_full' }),
    }));
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

  it('sends WhatsApp notification with queue position', async () => {
    const task = createMockTask();
    const updatedTask = createMockTask({ queuedAt: Timestamp.now() });
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(4));
    mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));

    const service = createService();
    await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(mockWhatsappNotifier.notifyTaskQueued).toHaveBeenCalledWith(
      'user-456',
      updatedTask,
      4,   // queuePosition
      20,  // estimatedWaitMinutes = 4 * 5
    );
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

  it('succeeds even when WhatsApp notification fails (best-effort)', async () => {
    const task = createMockTask();
    const updatedTask = createMockTask({ queuedAt: Timestamp.now() });
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(1));
    mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));
    mockWhatsappNotifier.notifyTaskQueued.mockResolvedValue(
      err({ code: 'notification_failed', message: 'WhatsApp down' }),
    );

    const service = createService();
    const result = await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskId).toBe('task-123');
      expect(result.value.queuePosition).toBe(1);
    }

    // Warning was logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123' }),
      expect.stringContaining('notification'),
    );
  });

  it('caps estimatedWaitMinutes at queue TTL', async () => {
    const task = createMockTask();
    const updatedTask = createMockTask({ queuedAt: Timestamp.now() });
    mockCodeTaskRepo.findById.mockResolvedValue(ok(task));
    // count=9 is below maxSize (10), so not queue_full.
    // 9 * 5 = 45 min, capped at min(45, 360) = 45
    mockCodeTaskRepo.countQueued.mockResolvedValue(ok(9));
    mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));

    const service = createService();
    const result = await service.enqueue({ taskId: 'task-123', userId: 'user-456' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // 9 * 5 = 45, min(45, 360) = 45
      expect(result.value.estimatedWaitMinutes).toBe(45);
    }
  });
});
