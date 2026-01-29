/**
 * Tests for WhatsAppNotifier implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { ok, err } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createWhatsAppNotifier, type WhatsAppNotifierConfig } from '../../../infra/services/whatsappNotifierImpl.js';
import type { CodeTask, TaskError, TaskResult } from '../../../domain/models/codeTask.js';

describe('WhatsAppNotifier', () => {
  let mockPublisher: WhatsAppSendPublisher;

  beforeEach(() => {
    mockPublisher = {
      publishSendMessage: vi.fn(),
    } as unknown as WhatsAppSendPublisher;
  });

  const getPublishSendMessageMock = (): ReturnType<typeof vi.fn> =>
    mockPublisher.publishSendMessage as ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createMockTask = (overrides?: Partial<CodeTask>): CodeTask => ({
    id: 'task-123',
    prompt: 'Fix login bug',
    systemPromptHash: 'abc123',
    repository: 'test/repo',
    baseBranch: 'main',
    workerType: 'opus',
    workerLocation: 'mac',
    status: 'completed',
    createdAt: Timestamp.fromDate(new Date()),
    updatedAt: Timestamp.fromDate(new Date()),
    traceId: 'trace-123',
    userId: 'user-123',
    sanitizedPrompt: 'fix login bug',
    dedupKey: 'dedup-123',
    callbackReceived: false,
    ...overrides,
  });

  const createMockConfig = (): WhatsAppNotifierConfig => ({
    whatsappPublisher: mockPublisher,
  });

  const createMockResult = (overrides?: Partial<TaskResult>): TaskResult => ({
    branch: 'fix/login-bug',
    commits: 3,
    summary: 'Fixed login redirect handling',
    ...overrides,
  });

  describe('formatCompletionMessage', () => {
    it('formats completion message with result containing PR', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        result: createMockResult({
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
        }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      expect(getPublishSendMessageMock()).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          message: expect.stringContaining('✅ Code task completed: Fix login bug'),
          correlationId: 'trace-123',
        })
      );

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('PR: https://github.com/pbuchman/intexuraos/pull/123');
      expect(callArgs.message).toContain('Branch: fix/login-bug');
      expect(callArgs.message).toContain('Commits: 3');
      expect(callArgs.message).toContain('Fixed login redirect handling');
    });

    it('formats completion message without PR URL', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        result: createMockResult({
          prUrl: undefined as unknown as string,
        }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).not.toContain('PR:');
      expect(callArgs.message).toContain('Branch: fix/login-bug');
      expect(callArgs.message).toContain('Commits: 3');
    });

    it('formats completion message with empty PR URL string', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        result: createMockResult({
          prUrl: '',
        }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).not.toContain('PR:');
    });

    it('truncates long prompt when Linear title is missing', async () => {
      const longPrompt =
        'Fix the bug in the authentication system that causes issues when users try to log in with invalid credentials';
      const task = createMockTask({
        prompt: longPrompt,
        result: createMockResult({
          branch: 'fix/auth-bug',
          commits: 2,
          summary: 'Fixed auth bug',
        }),
      });
      const { linearIssueTitle: _, ...taskWithoutLinearTitle } = task;

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', taskWithoutLinearTitle);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain(
        '✅ Code task completed: Fix the bug in the authentication system that caus'
      );
    });

    it('includes Linear fallback warning when linearFallback is true', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        linearFallback: true,
        result: createMockResult(),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('⚠️ (Linear unavailable - no issue tracking)');
    });

    it('omits Linear fallback warning when linearFallback is false', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        linearFallback: false,
        result: createMockResult(),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).not.toContain('⚠️ (Linear unavailable');
    });

    it('uses Linear title when available', async () => {
      const task = createMockTask({
        prompt: 'Fix the bug in the authentication system',
        linearIssueTitle: 'INT-123 Fix auth bug',
        result: createMockResult({
          branch: 'fix/auth-bug',
          commits: 2,
          summary: 'Fixed auth bug',
        }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('✅ Code task completed: INT-123 Fix auth bug');
      expect(callArgs.message).not.toContain('Fix the bug in the authentication system');
    });

    it('handles completion without result', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
      } as Partial<CodeTask> as CodeTask);

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toBe('✅ Code task completed: Fix login bug');
      expect(callArgs.message).not.toContain('Branch:');
      expect(callArgs.message).not.toContain('Commits:');
    });
  });

  describe('formatFailureMessage', () => {
    const createMockError = (overrides?: Partial<TaskError>): TaskError => ({
      code: 'test_error',
      message: 'Test error occurred',
      ...overrides,
    });

    it('formats failure message correctly', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        status: 'failed',
      });
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskFailed('user-123', task, error);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('❌ Code task failed: Fix login bug');
      expect(callArgs.message).toContain('Error: Test error occurred');
    });

    it('includes remediation suggestion when available', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        status: 'failed',
      });
      const error = createMockError({
        message: 'Test error occurred',
        remediation: {
          manualSteps: 'Check the logs',
        },
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskFailed('user-123', task, error);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('Suggestion: Check the logs');
    });

    it('omits remediation when manualSteps is empty string', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        status: 'failed',
      });
      const error = createMockError({
        message: 'Test error occurred',
        remediation: {
          manualSteps: '',
        },
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskFailed('user-123', task, error);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).not.toContain('Suggestion:');
    });

    it('omits remediation when remediation itself is undefined', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        status: 'failed',
      });
      const error = createMockError({
        message: 'Test error occurred',
      });
      const { remediation: _, ...errorWithoutRemediation } = error;

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskFailed('user-123', task, errorWithoutRemediation);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).not.toContain('Suggestion:');
    });

    it('includes Linear fallback warning when linearFallback is true', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        linearFallback: true,
        status: 'failed',
      });
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskFailed('user-123', task, error);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('⚠️ (Linear unavailable - no issue tracking)');
    });

    it('omits Linear fallback warning when linearFallback is false', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        linearFallback: false,
        status: 'failed',
      });
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskFailed('user-123', task, error);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).not.toContain('⚠️ (Linear unavailable');
    });

    it('truncates long prompt when Linear title is missing', async () => {
      const longPrompt =
        'Fix the bug in the authentication system that causes issues when users try to log in with invalid credentials';
      const task = createMockTask({
        prompt: longPrompt,
        status: 'failed',
      });
      const { linearIssueTitle: _, ...taskWithoutLinearTitle } = task;
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskFailed('user-123', taskWithoutLinearTitle, error);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain(
        '❌ Code task failed: Fix the bug in the authentication system that caus'
      );
    });

    it('uses Linear title when available for failure', async () => {
      const task = createMockTask({
        prompt: 'Fix the bug in the authentication system',
        linearIssueTitle: 'INT-123 Fix auth bug',
        status: 'failed',
      });
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskFailed('user-123', task, error);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('❌ Code task failed: INT-123 Fix auth bug');
      expect(callArgs.message).not.toContain('Fix the bug in the authentication system');
    });
  });

  describe('notifyTaskComplete', () => {
    it('sends notification with correlationId from traceId', async () => {
      const task = createMockTask({
        result: createMockResult(),
        traceId: 'test-trace-id',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyTaskComplete('user-123', task);

      expect(result.ok).toBe(true);
      expect(getPublishSendMessageMock()).toHaveBeenCalledWith({
        userId: 'user-123',
        message: expect.any(String),
        correlationId: 'test-trace-id',
      });
    });

    it('returns error when notification fails', async () => {
      const task = createMockTask({
        result: createMockResult(),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'PUBLISH_ERROR', message: 'Service unavailable' })
      );

      const result = await notifier.notifyTaskComplete('user-123', task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service unavailable');
      }
    });
  });

  describe('notifyTaskFailed', () => {
    it('sends failure notification with correlationId', async () => {
      const task = createMockTask({
        status: 'failed',
        traceId: 'test-trace-id',
      });
      const error: TaskError = {
        code: 'test_error',
        message: 'Test error occurred',
      };

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyTaskFailed('user-123', task, error);

      expect(result.ok).toBe(true);
      expect(getPublishSendMessageMock()).toHaveBeenCalledWith({
        userId: 'user-123',
        message: expect.any(String),
        correlationId: 'test-trace-id',
      });
    });

    it('returns error when failure notification fails', async () => {
      const task = createMockTask({
        status: 'failed',
      });
      const error: TaskError = {
        code: 'test_error',
        message: 'Test error occurred',
      };

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'PUBLISH_ERROR', message: 'Service unavailable' })
      );

      const result = await notifier.notifyTaskFailed('user-123', task, error);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service unavailable');
      }
    });
  });

  describe('notifyTaskStarted', () => {
    it('sends started notification with task details', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        status: 'running',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'test-trace-id',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyTaskStarted('user-123', task);

      expect(result.ok).toBe(true);
      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('🚀 Code task started: Fix login bug');
      expect(callArgs.message).toContain('Task ID: task-123');
      expect(callArgs.message).toContain('Repository: pbuchman/intexuraos');
      expect(callArgs.message).toContain('Branch: development');
      expect(callArgs.correlationId).toBe('test-trace-id');
    });

    it('sends notification with Cancel and View buttons when cancelNonce is set', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        status: 'running',
        cancelNonce: 'a1b2',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskStarted('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.buttons).toHaveLength(2);
      expect(callArgs.buttons[0]).toEqual({
        type: 'reply',
        reply: {
          id: 'cancel-task:task-123:a1b2',
          title: '❌ Cancel Task',
        },
      });
      expect(callArgs.buttons[1]).toEqual({
        type: 'reply',
        reply: {
          id: 'view-task:task-123',
          title: '👁️ View Progress',
        },
      });
    });

    it('sends notification with only View button when cancelNonce is not set', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        status: 'running',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskStarted('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.buttons).toHaveLength(1);
      expect(callArgs.buttons[0]).toEqual({
        type: 'reply',
        reply: {
          id: 'view-task:task-123',
          title: '👁️ View Progress',
        },
      });
    });

    it('truncates long prompt when Linear title is missing', async () => {
      const longPrompt =
        'Fix the bug in the authentication system that causes issues when users try to log in with invalid credentials';
      const task = createMockTask({
        prompt: longPrompt,
        status: 'running',
      });
      const { linearIssueTitle: _, ...taskWithoutLinearTitle } = task;

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskStarted('user-123', taskWithoutLinearTitle);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain(
        '🚀 Code task started: Fix the bug in the authentication system that caus'
      );
    });

    it('returns error when notification fails', async () => {
      const task = createMockTask({
        status: 'running',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'PUBLISH_ERROR', message: 'Service unavailable' })
      );

      const result = await notifier.notifyTaskStarted('user-123', task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service unavailable');
      }
    });
  });
});
