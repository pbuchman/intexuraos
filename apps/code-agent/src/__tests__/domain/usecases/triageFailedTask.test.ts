/**
 * Tests for triageFailedTask use case.
 *
 * INT-1375: Self-healing failure triage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import {
  triageFailedTask,
  type TriageFailedTaskDeps,
} from '../../../domain/usecases/triageFailedTask.js';
import type { CodeTask, TaskError } from '../../../domain/models/codeTask.js';

describe('triageFailedTask', () => {
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
    notifyTaskAutoRetryExhausted: ReturnType<typeof vi.fn>;
  };
  let mockLogLineRepo: {
    listRecent: ReturnType<typeof vi.fn>;
  };
  let mockUserServiceClient: {
    getLlmClient: ReturnType<typeof vi.fn>;
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

  function buildDeps(): TriageFailedTaskDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as TriageFailedTaskDeps['codeTaskRepo'],
      taskEnqueueService: mockTaskEnqueueService as unknown as TriageFailedTaskDeps['taskEnqueueService'],
      whatsappNotifier: mockWhatsappNotifier as unknown as TriageFailedTaskDeps['whatsappNotifier'],
      logLineRepo: mockLogLineRepo as unknown as TriageFailedTaskDeps['logLineRepo'],
      userServiceClient: mockUserServiceClient as unknown as TriageFailedTaskDeps['userServiceClient'],
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
      notifyTaskAutoRetryExhausted: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockLogLineRepo = {
      listRecent: vi.fn().mockResolvedValue(ok([])),
    };

    mockUserServiceClient = {
      getLlmClient: vi.fn(),
    };
  });

  describe('retry verdict', () => {
    it('auto-retries infrastructure failures immediately (SETUP_FAILED → action: retried)', async () => {
      const task = buildTask({ id: 'task_infra' });
      const taskError: TaskError = { code: 'SETUP_FAILED', message: 'Setup script failed' };

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('retried');
      expect(result.retryTaskId).toBeDefined();
      expect(mockCodeTaskRepo.create).toHaveBeenCalledOnce();
      expect(mockUserServiceClient.getLlmClient).not.toHaveBeenCalled();
    });
  });

  describe('retry_after_cooloff verdict', () => {
    it('auto-retries rate-limit failures (429 → action: retried_after_cooloff)', async () => {
      const task = buildTask({ id: 'task_ratelimit' });
      const taskError: TaskError = {
        code: 'TASK_RESUMED_HARD_ERROR',
        message: 'Agent exited with code 429',
      };

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('retried_after_cooloff');
      expect(result.retryTaskId).toBeDefined();
      expect(mockCodeTaskRepo.create).toHaveBeenCalledOnce();
    });
  });

  describe('ask_llm verdict', () => {
    it('calls user LLM for enforcement failures and retries if shouldRetry=true (action: retried)', async () => {
      const task = buildTask({ id: 'task_enforcement' });
      const taskError: TaskError = {
        code: 'FORMAT_ENFORCEMENT_FAILED',
        message: 'Agent output did not match required format',
      };

      const mockGenerate = vi.fn().mockResolvedValue(
        ok({ content: '{"shouldRetry": true, "reason": "transient formatting error"}' })
      );
      mockUserServiceClient.getLlmClient.mockResolvedValue(ok({ generate: mockGenerate }));
      mockLogLineRepo.listRecent.mockResolvedValue(
        ok([{ sequence: 1, text: 'Task starting...', timestamp: Timestamp.now() }])
      );

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('retried');
      expect(mockUserServiceClient.getLlmClient).toHaveBeenCalledOnce();
      expect(mockUserServiceClient.getLlmClient).toHaveBeenCalledWith('user_123');
      expect(mockGenerate).toHaveBeenCalledOnce();
      expect(mockCodeTaskRepo.create).toHaveBeenCalledOnce();
    });

    it('falls through to permanent failure when LLM says no (action: permanent_failure)', async () => {
      const task = buildTask({ id: 'task_enforcement' });
      const taskError: TaskError = {
        code: 'QUALITY_ENFORCEMENT_FAILED',
        message: 'Output quality check failed',
      };

      const mockGenerate = vi.fn().mockResolvedValue(
        ok({ content: '{"shouldRetry": false, "reason": "systematic misunderstanding"}' })
      );
      mockUserServiceClient.getLlmClient.mockResolvedValue(ok({ generate: mockGenerate }));

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('permanent_failure');
      expect(result.reason).toContain('LLM triage');
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });

    it('falls through to permanent failure when LLM client resolution fails (action: permanent_failure)', async () => {
      const task = buildTask({ id: 'task_enforcement' });
      const taskError: TaskError = {
        code: 'REVIEW_ENFORCEMENT_FAILED',
        message: 'Review check failed',
      };

      mockUserServiceClient.getLlmClient.mockResolvedValue(
        err({ code: 'NO_API_KEY', message: 'No API key configured' })
      );

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('permanent_failure');
      expect(result.reason).toContain('User LLM unavailable');
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task_enforcement', userId: 'user_123' }),
        expect.stringContaining('Failed to resolve user LLM client')
      );
    });
  });

  describe('fail verdict', () => {
    it('returns permanent_failure for unrecognized errors (action: permanent_failure)', async () => {
      const task = buildTask({ id: 'task_unknown' });
      const taskError: TaskError = {
        code: 'COMPLETELY_UNKNOWN_ERROR',
        message: 'Something unrecognized happened',
      };

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('permanent_failure');
      expect(result.reason).toContain('Classified as permanent');
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
      expect(mockUserServiceClient.getLlmClient).not.toHaveBeenCalled();
    });
  });

  describe('autoRetryTask internal errors', () => {
    it('returns permanent_failure when autoRetryTask returns internal_error (action: permanent_failure)', async () => {
      // Use SETUP_FAILED which triggers immediate retry verdict (no LLM step)
      // Build a chain that won't exhaust budget but make create() fail so autoRetryTask returns internal_error
      const task = buildTask({ id: 'task_internal_err' });
      const taskError: TaskError = { code: 'SETUP_FAILED', message: 'Setup crashed' };

      mockCodeTaskRepo.create.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'write failed' })
      );

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('permanent_failure');
      expect(result.reason).toContain('Auto-retry failed');
    });
  });

  describe('log line fetch failure', () => {
    it('calls LLM with empty log lines when listRecent fails (action: permanent_failure when LLM says no)', async () => {
      const task = buildTask({ id: 'task_logfail' });
      const taskError: TaskError = {
        code: 'FORMAT_ENFORCEMENT_FAILED',
        message: 'Output format error',
      };

      const mockGenerate = vi.fn().mockResolvedValue(
        ok({ content: '{"shouldRetry": false, "reason": "systematic error"}' })
      );
      mockUserServiceClient.getLlmClient.mockResolvedValue(ok({ generate: mockGenerate }));
      // Make listRecent fail
      mockLogLineRepo.listRecent.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'read failed' })
      );

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      // LLM was still called (with empty log lines)
      expect(mockGenerate).toHaveBeenCalledOnce();
      // Warn was emitted about log fetch failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task_logfail' }),
        expect.stringContaining('Failed to fetch log lines')
      );
      expect(result.action).toBe('permanent_failure');
    });
  });

  describe('LLM generate failure', () => {
    it('returns permanent_failure when LLM generate call fails (action: permanent_failure)', async () => {
      const task = buildTask({ id: 'task_genfail' });
      const taskError: TaskError = {
        code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
        message: 'Agent output check failed',
      };

      const mockGenerate = vi.fn().mockResolvedValue(
        err({ code: 'LLM_ERROR', message: 'model unavailable' })
      );
      mockUserServiceClient.getLlmClient.mockResolvedValue(ok({ generate: mockGenerate }));

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('permanent_failure');
      expect(result.reason).toContain('LLM call failed');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task_genfail' }),
        expect.stringContaining('LLM triage call failed')
      );
    });
  });

  describe('budget exhaustion', () => {
    function buildExhaustedChain(): void {
      // Build a chain of 4 tasks: task_4 → task_3 → task_2 → task_1
      // This gives depth=3 which exceeds MAX_AUTO_RETRY_DEPTH
      const task1 = buildTask({ id: 'task_1' });
      const task2 = buildTask({ id: 'task_2', retriedFrom: 'task_1' });
      const task3 = buildTask({ id: 'task_3', retriedFrom: 'task_2' });

      mockCodeTaskRepo.findById
        .mockResolvedValueOnce(ok(task3))  // walk task_4 → task_3
        .mockResolvedValueOnce(ok(task2))  // walk task_3 → task_2
        .mockResolvedValueOnce(ok(task1)); // walk task_2 → task_1
    }

    it('returns permanent_failure with exhausted reason when budget exceeded', async () => {
      const task = buildTask({ id: 'task_4', retriedFrom: 'task_3' });
      const taskError: TaskError = { code: 'SETUP_FAILED', message: 'Setup failed again' };
      buildExhaustedChain();

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('permanent_failure');
      expect(result.reason).toContain('budget exhausted');
    });

    it('sends exhausted WhatsApp notification when budget exceeded', async () => {
      const task = buildTask({ id: 'task_4', retriedFrom: 'task_3' });
      const taskError: TaskError = { code: 'SETUP_FAILED', message: 'Setup failed again' };
      buildExhaustedChain();

      await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(mockWhatsappNotifier.notifyTaskAutoRetryExhausted).toHaveBeenCalledOnce();
      expect(mockWhatsappNotifier.notifyTaskAutoRetryExhausted).toHaveBeenCalledWith(
        'user_123',
        task,
        { attempts: 3, errorMessage: 'Setup failed again' }
      );
    });
  });
});
