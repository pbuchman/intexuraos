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
  COOLOFF_FALLBACK_MS,
  type TriageFailedTaskDeps,
} from '../../../domain/usecases/triageFailedTask.js';
import type { CodeTask, TaskError } from '../../../domain/models/codeTask.js';

// Default config mock — individual tests override autoRetry.maxAttempts as needed.
vi.mock('../../../config.js', () => ({
  loadConfig: (): {
    queue: { maxSize: number; ttlMinutes: number };
    autoRetry: { maxAttempts: number };
  } => ({
    queue: { maxSize: 50, ttlMinutes: 1440 },
    autoRetry: { maxAttempts: 3 },
  }),
}));

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
    getUserTimezone: ReturnType<typeof vi.fn>;
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
      getUserTimezone: vi.fn().mockResolvedValue(undefined),
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
    const CODEX_PRODUCTION_MESSAGE =
      "Non-zero exit code: 1; Codex error: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 6:14 PM.; No EXECUTION_AGENT_FINAL: block in transcript";
    const UNPARSEABLE_RATE_LIMIT_MESSAGE =
      'Non-zero exit code: 1; Runtime error: API returned 429 Too Many Requests';

    it('auto-retries rate-limit failures (429 → action: retried_after_cooloff)', async () => {
      const task = buildTask({ id: 'task_ratelimit' });
      const taskError: TaskError = {
        code: 'TASK_RESUMED_HARD_ERROR',
        message: 'Agent exited with code 429',
      };

      // No LLM key — should use fallback delay.
      mockUserServiceClient.getLlmClient.mockResolvedValue(
        err({ code: 'NO_API_KEY', message: 'no key' })
      );

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('retried_after_cooloff');
      expect(result.retryTaskId).toBeDefined();
      expect(mockCodeTaskRepo.create).toHaveBeenCalledOnce();
    });

    it('parses Codex try-again reset times deterministically without calling the user LLM', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-05T17:44:20.623Z'));
      mockUserServiceClient.getUserTimezone.mockResolvedValue('Europe/Warsaw');
      mockUserServiceClient.getLlmClient.mockResolvedValue(
        err({ code: 'NO_API_KEY', message: 'should not be used' })
      );

      try {
        const task = buildTask({ id: 'task_codex_cooloff', workerType: 'codex' });
        const taskError: TaskError = {
          code: 'TASK_RUNTIME_HARD_ERROR',
          message: CODEX_PRODUCTION_MESSAGE,
        };

        const result = await triageFailedTask(buildDeps(), {
          task,
          completedAt: new Date(),
          taskError,
        });

        expect(result.action).toBe('retried_after_cooloff');
        expect(mockUserServiceClient.getUserTimezone).toHaveBeenCalledWith('user_123');
        expect(mockUserServiceClient.getLlmClient).not.toHaveBeenCalled();

        const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0] as
          | { dispatchSchedule?: Record<string, unknown> }
          | undefined;
        expect(createInput?.dispatchSchedule).toBeDefined();
        expect(createInput?.dispatchSchedule?.['derivedBy']).toBe('parser');
        expect(createInput?.dispatchSchedule?.['source']).toBe('retry_cooloff');
        expect(createInput?.dispatchSchedule?.['timezone']).toBe('UTC');
        expect(createInput?.dispatchSchedule?.['sourceText']).toBe('try again at 6:14 PM');
        const persisted = createInput?.dispatchSchedule?.['notBeforeAt'];
        expect(persisted).toBeInstanceOf(Date);
        expect((persisted as Date).toISOString()).toBe('2026-05-05T18:14:00.000Z');
      } finally {
        vi.useRealTimers();
      }
    });

    it('passes cooloffSchedule with derivedBy "llm" when the LLM returns a valid future timestamp', async () => {
      const task = buildTask({ id: 'task_cooloff_prod' });
      const taskError: TaskError = {
        code: 'TASK_RUNTIME_HARD_ERROR',
        message: UNPARSEABLE_RATE_LIMIT_MESSAGE,
      };

      // Future reset ~10 hours away.
      const futureIso = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
      const mockGenerate = vi.fn().mockResolvedValue(
        ok({
          content: JSON.stringify({
            notBeforeAt: futureIso,
            timezone: 'UTC',
            sourceText: 'resets 10pm (UTC)',
            reason: 'Claude usage limit resets at 10 PM UTC',
          }),
        })
      );
      mockUserServiceClient.getLlmClient.mockResolvedValue(ok({ generate: mockGenerate }));
      mockUserServiceClient.getUserTimezone.mockResolvedValue('UTC');

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('retried_after_cooloff');
      expect(mockUserServiceClient.getUserTimezone).toHaveBeenCalledWith('user_123');
      expect(mockGenerate).toHaveBeenCalledOnce();
      expect(mockGenerate.mock.calls[0]?.[1]).toMatchObject({ promptType: 'cooloff-retry' });

      const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0] as
        | { dispatchSchedule?: Record<string, unknown> }
        | undefined;
      expect(createInput?.dispatchSchedule).toBeDefined();
      expect(createInput?.dispatchSchedule?.['derivedBy']).toBe('llm');
      expect(createInput?.dispatchSchedule?.['source']).toBe('retry_cooloff');
      const persisted = createInput?.dispatchSchedule?.['notBeforeAt'];
      expect(persisted).toBeInstanceOf(Date);
      expect((persisted as Date).toISOString()).toBe(futureIso);
    });

    it('falls back to derivedBy "fallback" with ~60-minute delay when LLM returns invalid JSON', async () => {
      const task = buildTask({ id: 'task_cooloff_badjson' });
      const taskError: TaskError = {
        code: 'TASK_RUNTIME_HARD_ERROR',
        message: UNPARSEABLE_RATE_LIMIT_MESSAGE,
      };

      const mockGenerate = vi.fn().mockResolvedValue(
        ok({ content: 'not a json blob at all' })
      );
      mockUserServiceClient.getLlmClient.mockResolvedValue(ok({ generate: mockGenerate }));

      const before = Date.now();
      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });
      const after = Date.now();

      expect(result.action).toBe('retried_after_cooloff');

      const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0] as
        | { dispatchSchedule?: Record<string, unknown> }
        | undefined;
      expect(createInput?.dispatchSchedule?.['derivedBy']).toBe('fallback');
      expect(createInput?.dispatchSchedule?.['source']).toBe('retry_cooloff');
      const persisted = createInput?.dispatchSchedule?.['notBeforeAt'] as Date;
      // `new Date()` is sampled inside the use case at some point in [before, after],
      // so the persisted delay is exactly COOLOFF_FALLBACK_MS relative to that sample.
      expect(persisted.getTime() - before).toBeGreaterThanOrEqual(COOLOFF_FALLBACK_MS);
      expect(persisted.getTime() - after).toBeLessThanOrEqual(COOLOFF_FALLBACK_MS);
    });

    it('falls back to derivedBy "fallback" when userServiceClient.getLlmClient errors and propagates known user timezone', async () => {
      const task = buildTask({ id: 'task_cooloff_nokey' });
      const taskError: TaskError = {
        code: 'TASK_RUNTIME_HARD_ERROR',
        message: UNPARSEABLE_RATE_LIMIT_MESSAGE,
      };

      // Timezone is known, but LLM client is unavailable — fallback path
      // must still carry the user timezone onto the retry schedule (INT-1468).
      mockUserServiceClient.getUserTimezone.mockResolvedValue('America/New_York');
      mockUserServiceClient.getLlmClient.mockResolvedValue(
        err({ code: 'NO_API_KEY', message: 'no key' })
      );

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('retried_after_cooloff');
      const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0] as
        | { dispatchSchedule?: Record<string, unknown> }
        | undefined;
      expect(createInput?.dispatchSchedule?.['derivedBy']).toBe('fallback');
      expect(createInput?.dispatchSchedule?.['timezone']).toBe('America/New_York');
    });

    it('still calls LLM with empty log lines when logLineRepo.listRecent returns err', async () => {
      const task = buildTask({ id: 'task_cooloff_logfail' });
      const taskError: TaskError = {
        code: 'TASK_RUNTIME_HARD_ERROR',
        message: UNPARSEABLE_RATE_LIMIT_MESSAGE,
      };

      mockLogLineRepo.listRecent.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'read failed' })
      );
      const mockGenerate = vi.fn().mockResolvedValue(ok({ content: 'bogus' }));
      mockUserServiceClient.getLlmClient.mockResolvedValue(ok({ generate: mockGenerate }));

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('retried_after_cooloff');
      expect(mockGenerate).toHaveBeenCalledOnce();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task_cooloff_logfail' }),
        expect.stringContaining('Failed to fetch log lines for cooloff parsing')
      );
    });

    it('tolerates getUserTimezone throwing and falls through to LLM with undefined timezone', async () => {
      const task = buildTask({ id: 'task_cooloff_tz_throw' });
      const taskError: TaskError = {
        code: 'TASK_RUNTIME_HARD_ERROR',
        message: UNPARSEABLE_RATE_LIMIT_MESSAGE,
      };

      mockUserServiceClient.getUserTimezone.mockRejectedValue(new Error('tz boom'));
      const futureIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const mockGenerate = vi.fn().mockResolvedValue(
        ok({
          content: JSON.stringify({
            notBeforeAt: futureIso,
            reason: 'r',
          }),
        })
      );
      mockUserServiceClient.getLlmClient.mockResolvedValue(ok({ generate: mockGenerate }));

      const result = await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(result.action).toBe('retried_after_cooloff');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task_cooloff_tz_throw' }),
        expect.stringContaining('Failed to fetch user timezone')
      );
      const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0] as
        | { dispatchSchedule?: Record<string, unknown> }
        | undefined;
      expect(createInput?.dispatchSchedule?.['derivedBy']).toBe('llm');
    });

    it('falls back to derivedBy "fallback" when LLM generate itself fails', async () => {
      const task = buildTask({ id: 'task_cooloff_gen_err' });
      const taskError: TaskError = {
        code: 'TASK_RUNTIME_HARD_ERROR',
        message: UNPARSEABLE_RATE_LIMIT_MESSAGE,
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

      expect(result.action).toBe('retried_after_cooloff');
      const createInput = mockCodeTaskRepo.create.mock.calls[0]?.[0] as
        | { dispatchSchedule?: Record<string, unknown> }
        | undefined;
      expect(createInput?.dispatchSchedule?.['derivedBy']).toBe('fallback');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task_cooloff_gen_err' }),
        expect.stringContaining('LLM cooloff call failed')
      );
    });

    it('does NOT fetch user LLM or timezone for the plain "retry" verdict', async () => {
      const task = buildTask({ id: 'task_retry_plain' });
      const taskError: TaskError = { code: 'SETUP_FAILED', message: 'infra blew up' };

      await triageFailedTask(buildDeps(), {
        task,
        completedAt: new Date(),
        taskError,
      });

      expect(mockUserServiceClient.getLlmClient).not.toHaveBeenCalled();
      expect(mockUserServiceClient.getUserTimezone).not.toHaveBeenCalled();
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
