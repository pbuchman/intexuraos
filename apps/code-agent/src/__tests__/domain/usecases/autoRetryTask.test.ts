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

    it('preserves the complete Sentry issue context on the auto-retry task', async () => {
      const sentryIssue = {
        organizationSlug: 'intexuraos',
        projectSlug: 'intexuraos-backend',
        projectId: '4509002',
        issueId: '110',
        issueShortId: 'INTEXURAOS-6E',
        issueUrl:
          'https://home-dev.example.ts.net:8443/organizations/intexuraos/issues/110/',
        title: 'Configuration warning',
        action: 'created',
        eventId: 'b493ff643e7e4856adbad08d108ba8b4',
        receivedAt: '2026-08-11T12:34:56.000Z',
      };
      const failedTask = buildTask({ id: 'task_orig', sentryIssue });

      const result = await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sentryIssue })
      );
      expect(mockCodeTaskRepo.create.mock.calls[0]?.[0]?.sentryIssue).toEqual(sentryIssue);
    });

    it('preserves the review target and requested review types on an auto-retry', async () => {
      const failedTask = buildTask({
        id: 'task-review-failed',
        agentType: 'review',
        reviewTypes: ['code_quality', 'security'],
        reviewCommitSha: 'commit-that-was-reviewed',
      });

      await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewTypes: ['code_quality', 'security'],
          reviewCommitSha: 'commit-that-was-reviewed',
        }),
      );
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

  describe('cooloff schedule (INT-1463)', () => {
    it('persists dispatchSchedule when cooloffSchedule.derivedBy is "llm"', async () => {
      const failedTask = buildTask({ id: 'task_cooloff_llm' });
      const notBeforeAt = new Date('2026-04-23T22:00:00Z');

      await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'rate limited',
        cooloffSchedule: {
          notBeforeAt,
          timezone: 'UTC',
          sourceText: 'resets 10pm (UTC)',
          derivedBy: 'llm',
        },
      });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledOnce();
      const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0] as
        | { dispatchSchedule?: Record<string, unknown> }
        | undefined;

      expect(createInput?.dispatchSchedule).toBeDefined();
      expect(createInput?.dispatchSchedule?.['source']).toBe('retry_cooloff');
      expect(createInput?.dispatchSchedule?.['derivedBy']).toBe('llm');
      expect(createInput?.dispatchSchedule?.['derivedFromTaskId']).toBe('task_cooloff_llm');
      expect(createInput?.dispatchSchedule?.['timezone']).toBe('UTC');
      expect(createInput?.dispatchSchedule?.['sourceText']).toBe('resets 10pm (UTC)');

      const persisted = createInput?.dispatchSchedule?.['notBeforeAt'];
      expect(persisted).toBeInstanceOf(Date);
      expect((persisted as Date).toISOString()).toBe(notBeforeAt.toISOString());
    });

    it('persists dispatchSchedule with derivedBy "fallback" when provided', async () => {
      const failedTask = buildTask({ id: 'task_cooloff_fb' });
      const notBeforeAt = new Date('2026-04-23T13:00:00Z');

      await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'rate limited',
        cooloffSchedule: {
          notBeforeAt,
          derivedBy: 'fallback',
          sourceText: 'parser failure',
        },
      });

      const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0] as
        | { dispatchSchedule?: Record<string, unknown> }
        | undefined;
      expect(createInput?.dispatchSchedule?.['derivedBy']).toBe('fallback');
      expect(createInput?.dispatchSchedule?.['source']).toBe('retry_cooloff');
      expect(createInput?.dispatchSchedule?.['derivedFromTaskId']).toBe('task_cooloff_fb');
      expect(createInput?.dispatchSchedule?.['timezone']).toBeUndefined();
    });

    it('omits dispatchSchedule entirely when cooloffSchedule is not provided', async () => {
      const failedTask = buildTask({ id: 'task_no_cooloff' });

      await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0] as
        | { dispatchSchedule?: unknown }
        | undefined;
      expect(createInput).toBeDefined();
      expect(createInput?.dispatchSchedule).toBeUndefined();
      expect(createInput && 'dispatchSchedule' in createInput).toBe(false);
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

  describe('queuedAt carry-forward (Fix D part 1)', () => {
    it('passes failedTask.queuedAt to enqueue when queuedAt is present', async () => {
      const t0 = new Date('2026-04-25T10:00:00.000Z');
      const failedTask = buildTask({
        id: 'task_orig',
        queuedAt: Timestamp.fromDate(t0),
      });

      await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledOnce();
      const enqueueArgs = mockTaskEnqueueService.enqueue.mock.calls[0]?.[0];
      expect(enqueueArgs?.queuedAt).toBeInstanceOf(Date);
      expect((enqueueArgs?.queuedAt as Date).getTime()).toBe(t0.getTime());
    });

    it('falls back to failedTask.createdAt when queuedAt is undefined', async () => {
      const t0 = new Date('2026-04-25T09:00:00.000Z');
      const failedTask = buildTask({
        id: 'task_orig',
        createdAt: Timestamp.fromDate(t0),
        // queuedAt explicitly omitted
      });

      await autoRetryTask(buildDeps(), {
        failedTask,
        failedWorkerLocation: 'home-mac',
        reason: 'worker_crashed',
      });

      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledOnce();
      const enqueueArgs = mockTaskEnqueueService.enqueue.mock.calls[0]?.[0];
      expect(enqueueArgs?.queuedAt).toBeInstanceOf(Date);
      expect((enqueueArgs?.queuedAt as Date).getTime()).toBe(t0.getTime());
    });
  });

  describe('autoRetryAttempt increment (Fix D part 2)', () => {
    it.each([
      { input: undefined, expected: 1 },
      { input: 1, expected: 2 },
      { input: 2, expected: 3 },
    ])(
      'increments autoRetryAttempt from $input to $expected',
      async ({ input, expected }) => {
        // Build a chain so countRetryDepth produces a non-zero depth matching `input` semantics
        // For input=undefined (no prior retry chain), depth=0 → attempt=1
        // For input=1 (one prior retry), chain is task_failed → task_prior, depth=1 → attempt=2
        // For input=2 (two prior retries), depth=2 → attempt=3
        const failedTaskId = 'task_failed';
        const overrides: Partial<CodeTask> = { id: failedTaskId };

        if (input === 1) {
          overrides.retriedFrom = 'task_prior_1';
          mockCodeTaskRepo.findById.mockResolvedValueOnce(ok(buildTask({ id: 'task_prior_1' })));
        } else if (input === 2) {
          overrides.retriedFrom = 'task_prior_1';
          mockCodeTaskRepo.findById
            .mockResolvedValueOnce(ok(buildTask({ id: 'task_prior_1', retriedFrom: 'task_prior_2' })))
            .mockResolvedValueOnce(ok(buildTask({ id: 'task_prior_2' })));
        }

        const failedTask = buildTask(overrides);

        await autoRetryTask(buildDeps(), {
          failedTask,
          failedWorkerLocation: 'home-mac',
          reason: 'worker_crashed',
        });

        expect(mockCodeTaskRepo.create).toHaveBeenCalledOnce();
        const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0];
        expect(createInput?.autoRetryAttempt).toBe(expected);
      },
    );
  });
});
