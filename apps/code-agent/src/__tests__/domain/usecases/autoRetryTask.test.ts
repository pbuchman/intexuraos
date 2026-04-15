/**
 * Tests for autoRetryTask use case.
 *
 * INT-1375: Self-healing failure triage.
 *
 * Test Requirements:
 * 1. retry budget - creates retry task when no previous retries (attempt 1)
 * 2. retry budget - walks retriedFrom chain to count depth (chain depth=2, under budget)
 * 3. retry budget - rejects when budget exhausted (depth >= 3)
 * 4. task creation - creates task with failedWorkerLocation and autoRetryAttempt
 * 5. task creation - enqueues the retry task for dispatch
 * 6. task creation - archives the failed task after creating retry
 * 7. whatsapp notification - sends auto-retry notification with attempt number and reason
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import {
  autoRetryTask,
  type AutoRetryTaskDeps,
} from '../../../domain/usecases/autoRetryTask.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';

describe('autoRetryTask', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockTaskEnqueueService: {
    enqueue: ReturnType<typeof vi.fn>;
  };
  let mockWhatsappNotifier: {
    notifyTaskAutoRetried: ReturnType<typeof vi.fn>;
  };

  function buildTask(overrides: Partial<CodeTask> = {}): CodeTask {
    return {
      id: 'task_failed',
      userId: 'user_123',
      status: 'failed',
      prompt: 'fix the bug',
      sanitizedPrompt: 'fix the bug',
      systemPromptHash: 'abc123',
      workerType: 'sonnet',
      workerLocation: 'home-mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_abc',
      callbackReceived: false,
      dedupKey: 'dedup_abc',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides,
    };
  }

  function buildDeps(): AutoRetryTaskDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as AutoRetryTaskDeps['codeTaskRepo'],
      taskEnqueueService: mockTaskEnqueueService as unknown as AutoRetryTaskDeps['taskEnqueueService'],
      whatsappNotifier: mockWhatsappNotifier as unknown as AutoRetryTaskDeps['whatsappNotifier'],
      orchestratorSecret: 'test-orch-secret',
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
      create: vi.fn().mockResolvedValue(ok(buildTask({ id: 'task_retry_1', status: 'queued' }))),
      update: vi.fn().mockResolvedValue(ok(buildTask({ status: 'archived' }))),
    };

    mockTaskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'task_retry_1', queuePosition: 1 })),
    };

    mockWhatsappNotifier = {
      notifyTaskAutoRetried: vi.fn().mockResolvedValue(ok(undefined)),
    };
  });

  describe('retry budget', () => {
    it('creates retry task when no previous retries (attempt 1)', async () => {
      const failedTask = buildTask({ id: 'task_1' });

      const result = await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.autoRetryAttempt).toBe(1);
      expect(mockCodeTaskRepo.findById).not.toHaveBeenCalled();
    });

    it('walks retriedFrom chain to count depth (chain: task_3->task_2->task_1, depth=2, under budget)', async () => {
      const task1 = buildTask({ id: 'task_1' });
      const task2 = buildTask({ id: 'task_2', retriedFrom: 'task_1' });
      const task3 = buildTask({ id: 'task_3', retriedFrom: 'task_2' });

      mockCodeTaskRepo.findById
        .mockResolvedValueOnce(ok(task2)) // walk from task_3 -> task_2
        .mockResolvedValueOnce(ok(task1)); // walk from task_2 -> task_1

      const result = await autoRetryTask(buildDeps(), {
        failedTask: task3,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.autoRetryAttempt).toBe(3);
      expect(mockCodeTaskRepo.findById).toHaveBeenCalledTimes(2);
      expect(mockCodeTaskRepo.findById).toHaveBeenNthCalledWith(1, 'task_2');
      expect(mockCodeTaskRepo.findById).toHaveBeenNthCalledWith(2, 'task_1');
    });

    it('stops chain walking and uses depth so far when findById returns error for a parent', async () => {
      const task2 = buildTask({ id: 'task_2', retriedFrom: 'task_1' });
      const task3 = buildTask({ id: 'task_3', retriedFrom: 'task_2' });

      mockCodeTaskRepo.findById
        .mockResolvedValueOnce(ok(task2)) // walk from task_3 -> task_2
        .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'task_1 not found' })); // error fetching task_1

      const result = await autoRetryTask(buildDeps(), {
        failedTask: task3,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      // Chain stopped at depth=2 (task_3->task_2->error), so attempt=3 which is within budget
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.autoRetryAttempt).toBe(3);
      expect(mockCodeTaskRepo.findById).toHaveBeenCalledTimes(2);
    });

    it('rejects when budget exhausted (chain: task_4->task_3->task_2->task_1, depth=3)', async () => {
      const task1 = buildTask({ id: 'task_1' });
      const task2 = buildTask({ id: 'task_2', retriedFrom: 'task_1' });
      const task3 = buildTask({ id: 'task_3', retriedFrom: 'task_2' });
      const task4 = buildTask({ id: 'task_4', retriedFrom: 'task_3' });

      mockCodeTaskRepo.findById
        .mockResolvedValueOnce(ok(task3))
        .mockResolvedValueOnce(ok(task2))
        .mockResolvedValueOnce(ok(task1));

      const result = await autoRetryTask(buildDeps(), {
        failedTask: task4,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('budget_exhausted');
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('task creation', () => {
    it('creates task with failedWorkerLocation and autoRetryAttempt', async () => {
      const failedTask = buildTask({
        id: 'task_orig',
        agentType: 'execution',
        linearIssueId: 'INT-999',
        prNumber: 42,
        prBranch: 'feature/fix',
      });

      await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'oom_killed',
      });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledOnce();
      const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0];
      expect(createInput).toMatchObject({
        userId: 'user_123',
        prompt: 'fix the bug',
        sanitizedPrompt: 'fix the bug',
        systemPromptHash: 'abc123',
        workerType: 'sonnet',
        workerLocation: 'queued',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        retriedFrom: 'task_orig',
        failedWorkerLocation: 'home-mac',
        autoRetryAttempt: 1,
        agentType: 'execution',
        linearIssueId: 'INT-999',
        prNumber: 42,
        prBranch: 'feature/fix',
      });
      // webhookSecret must be set for callback validation
      expect(createInput?.webhookSecret).toBeDefined();
      expect(typeof createInput?.webhookSecret).toBe('string');
      expect(String(createInput?.webhookSecret ?? '').length).toBeGreaterThan(0);
    });

    it('enqueues the retry task for dispatch', async () => {
      const failedTask = buildTask({ id: 'task_orig' });

      const result = await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(result.ok).toBe(true);
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledOnce();
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user_123' })
      );
    });

    it('archives the failed task after creating retry', async () => {
      const failedTask = buildTask({ id: 'task_orig' });

      await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_orig', { status: 'archived' });
    });

    it('returns internal_error when task creation fails', async () => {
      mockCodeTaskRepo.create.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'write failed' })
      );

      const failedTask = buildTask({ id: 'task_orig' });

      const result = await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('internal_error');
      expect(mockTaskEnqueueService.enqueue).not.toHaveBeenCalled();
    });

    it('returns internal_error when enqueue fails', async () => {
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        err({ code: 'queue_full', message: 'queue is full' })
      );

      const failedTask = buildTask({ id: 'task_orig' });

      const result = await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('internal_error');
    });
  });

  describe('whatsapp notification', () => {
    it('sends auto-retry notification with attempt number and reason', async () => {
      const failedTask = buildTask({ id: 'task_orig' });

      await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'oom_killed',
      });

      expect(mockWhatsappNotifier.notifyTaskAutoRetried).toHaveBeenCalledOnce();
      expect(mockWhatsappNotifier.notifyTaskAutoRetried).toHaveBeenCalledWith(
        'user_123',
        failedTask,
        { attempt: 1, maxAttempts: 3, reason: 'oom_killed', retryTaskId: expect.stringContaining('task_') }
      );
    });

    it('continues and returns ok even if archive step fails (non-fatal)', async () => {
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'archive failed' })
      );

      const failedTask = buildTask({ id: 'task_orig' });

      const result = await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(result.ok).toBe(true);
      expect(mockWhatsappNotifier.notifyTaskAutoRetried).toHaveBeenCalledOnce();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ failedTaskId: 'task_orig' }),
        expect.stringContaining('non-fatal')
      );
    });
  });
});
