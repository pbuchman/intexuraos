/**
 * Tests for WhatsAppNotifier implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { ok, err } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createWhatsAppNotifier, buildTaskUrl, type WhatsAppNotifierConfig } from '../../../infra/services/whatsappNotifierImpl.js';
import type { CodeTask, TaskError, TaskResult } from '../../../domain/models/codeTask.js';

describe('WhatsAppNotifier', () => {
  type MockTaskOverrides = Partial<CodeTask> & {
    linearIssueTitle?: string;
    linearFallback?: boolean;
  };

  let mockPublisher: WhatsAppSendPublisher;
  let linearIssueTitles: Map<string, string>;
  let mockLinearAgentClient: {
    fetchIssueForDisplay: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPublisher = {
      publishSendMessage: vi.fn(),
    } as unknown as WhatsAppSendPublisher;
    linearIssueTitles = new Map<string, string>();
    mockLinearAgentClient = {
      fetchIssueForDisplay: vi.fn(async ({ identifier }: { identifier: string }) => {
        const title = linearIssueTitles.get(identifier);
        if (title === undefined) {
          return err({ code: 'NOT_FOUND', message: 'not found' });
        }
        return ok({
          identifier,
          title,
          state: { name: 'In Progress', type: 'started' as const },
          priority: 0,
          assignee: null,
          labels: [],
          url: `https://linear.app/intexuraos/issue/${identifier}`,
          commentCount: 0,
          lastCommentAt: null,
        });
      }),
    };
  });

  const getPublishSendMessageMock = (): ReturnType<typeof vi.fn> =>
    mockPublisher.publishSendMessage as ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createMockTask = (overrides: MockTaskOverrides = {}): CodeTask => {
    const {
      linearIssueTitle,
      linearFallback: _linearFallback,
      ...taskOverrides
    } = overrides;
    const task: CodeTask = {
      id: 'task-123',
      prompt: 'Fix login bug',
      systemPromptHash: 'abc123',
      repository: 'test/repo',
      baseBranch: 'main',
      workerType: 'opus',
      workerLocation: 'mac',
      status: 'implemented',
      createdAt: Timestamp.fromDate(new Date()),
      updatedAt: Timestamp.fromDate(new Date()),
      traceId: 'trace-123',
      userId: 'user-123',
      sanitizedPrompt: 'fix login bug',
      dedupKey: 'dedup-123',
      callbackReceived: false,
      ...taskOverrides,
    };

    if (task.linearIssueId !== undefined && linearIssueTitle !== undefined) {
      linearIssueTitles.set(task.linearIssueId, linearIssueTitle);
    }

    return task;
  };

  const createMockConfig = (): WhatsAppNotifierConfig => ({
    whatsappPublisher: mockPublisher,
    linearAgentClient: mockLinearAgentClient as unknown as NonNullable<WhatsAppNotifierConfig['linearAgentClient']>,
  });

  const createMockResult = (overrides?: Partial<TaskResult>): TaskResult => ({
    branch: 'fix/login-bug',
    commits: 3,
    summary: 'Fixed login redirect handling',
    ...overrides,
  });

  describe('buildTaskUrl', () => {
    it('builds the correct deep link URL for a task', () => {
      expect(buildTaskUrl('task-123')).toBe('https://intexuraos.cloud/#/code-tasks/task-123');
    });

    it('handles task IDs with special characters', () => {
      expect(buildTaskUrl('task_abc-def')).toBe('https://intexuraos.cloud/#/code-tasks/task_abc-def');
    });
  });

  describe('formatCompletionMessage', () => {
    it('formats completion message with result containing PR and passes ctaUrl', async () => {
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
          ctaUrl: { displayText: 'View Pull Request', url: 'https://github.com/pbuchman/intexuraos/pull/123' },
          correlationId: 'trace-123',
        })
      );

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).not.toContain('PR:');
      expect(callArgs.message).toContain('Branch: fix/login-bug');
      expect(callArgs.message).toContain('Commits: 3');
      expect(callArgs.message).toContain('Fixed login redirect handling');
      expect(callArgs.ctaUrl).toEqual({
        displayText: 'View Pull Request',
        url: 'https://github.com/pbuchman/intexuraos/pull/123',
      });
    });

    it('formats completion message without PR URL and adds View Progress ctaUrl', async () => {
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
      expect(callArgs.ctaUrl).toEqual({
        displayText: 'View Progress',
        url: 'https://intexuraos.cloud/#/code-tasks/task-123',
      });
    });

    it('formats completion message with empty PR URL string and adds View Progress ctaUrl', async () => {
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
      expect(callArgs.ctaUrl).toEqual({
        displayText: 'View Progress',
        url: 'https://intexuraos.cloud/#/code-tasks/task-123',
      });
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

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain(
        '✅ Code task completed: Fix the bug in the authentication system that caus'
      );
    });

    it('does not include fallback warning when linearFallback is true', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        linearFallback: true,
        result: createMockResult(),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).not.toContain('⚠️ (Linear unavailable - no issue tracking)');
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
        linearIssueId: 'INT-123',
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

    it('falls back to prompt summary when live Linear title lookup fails', async () => {
      const task = createMockTask({
        prompt: 'Fix the bug in the authentication system',
        linearIssueId: 'INT-404',
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
      expect(mockLinearAgentClient.fetchIssueForDisplay).toHaveBeenCalledWith({
        userId: 'user-123',
        identifier: 'INT-404',
      });
      expect(callArgs.message).toContain(
        '✅ Code task completed: Fix the bug in the authentication system'
      );
      expect(callArgs.message).not.toContain('INT-404');
    });

    it('handles completion without result and adds View Progress ctaUrl', async () => {
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
      expect(callArgs.ctaUrl).toEqual({
        displayText: 'View Progress',
        url: 'https://intexuraos.cloud/#/code-tasks/task-123',
      });
    });

    it('formats completion with summary only (planning agent, no branch/commits)', async () => {
      const task = createMockTask({
        linearIssueId: 'INT-124',
        linearIssueTitle: 'Analyze auth flow',
        result: {
          summary: 'Analyzed the feature request and identified three approaches. Created design with test requirements. Task is ready for execution.',
        },
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('✅ Code task completed: Analyze auth flow');
      expect(callArgs.message).toContain('Analyzed the feature request');
      expect(callArgs.message).not.toContain('Branch:');
      expect(callArgs.message).not.toContain('Commits:');
      expect(callArgs.message).not.toContain('PR:');
    });

    it('formats completion with no summary and passes ctaUrl for PR', async () => {
      const task = createMockTask({
        linearIssueId: 'INT-125',
        linearIssueTitle: 'Quick fix',
        result: {
          prUrl: 'https://github.com/org/repo/pull/99',
          branch: 'fix/quick',
          commits: 1,
        },
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('✅ Code task completed: Quick fix');
      expect(callArgs.message).not.toContain('PR:');
      expect(callArgs.message).toContain('Branch: fix/quick');
      expect(callArgs.message).toContain('Commits: 1');
      expect(callArgs.ctaUrl).toEqual({
        displayText: 'View Pull Request',
        url: 'https://github.com/org/repo/pull/99',
      });
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

    it('does not include fallback warning when linearFallback is true', async () => {
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
      expect(callArgs.message).not.toContain('⚠️ (Linear unavailable - no issue tracking)');
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
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskFailed('user-123', task, error);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain(
        '❌ Code task failed: Fix the bug in the authentication system that caus'
      );
    });

    it('uses Linear title when available for failure', async () => {
      const task = createMockTask({
        prompt: 'Fix the bug in the authentication system',
        linearIssueId: 'INT-126',
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
        ctaUrl: {
          displayText: 'View Progress',
          url: 'https://intexuraos.cloud/#/code-tasks/task-123',
        },
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
    it('sends failure notification with ctaUrl deep link', async () => {
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
        ctaUrl: {
          displayText: '🔍 View Task',
          url: 'https://intexuraos.cloud/#/code-tasks/task-123',
        },
        correlationId: 'test-trace-id',
      });
      // Should NOT have reply buttons
      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.buttons).toBeUndefined();
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

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskStarted('user-123', task);

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

  describe('notifyTaskResumed', () => {
    it('sends resumed notification with task details', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        status: 'running',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'test-trace-id',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyTaskResumed('user-123', task);

      expect(result.ok).toBe(true);
      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('🔄 Code task resumed: Fix login bug');
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

      await notifier.notifyTaskResumed('user-123', task);

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

      await notifier.notifyTaskResumed('user-123', task);

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

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyTaskResumed('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain(
        '🔄 Code task resumed: Fix the bug in the authentication system that caus'
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

      const result = await notifier.notifyTaskResumed('user-123', task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service unavailable');
      }
    });
  });

  describe('notifyDesignComplete', () => {
    it('sends design-complete message with implement button', async () => {
      const task = createMockTask({
        linearIssueId: 'INT-127',
        linearIssueTitle: 'Add dark mode',
        result: createMockResult({ summary: 'Design plan with implementation steps.' }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyDesignComplete('user-123', task);

      expect(result.ok).toBe(true);
      expect(getPublishSendMessageMock()).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          message: expect.stringContaining('🎨 Design ready: Add dark mode'),
          buttons: [
            {
              type: 'reply',
              reply: {
                id: `proceed-implementation:${task.id}`,
                title: '▶️ Implement',
              },
            },
          ],
          correlationId: 'trace-123',
        })
      );
    });

    it('includes button prompt in message when buttons are sent', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Add dark mode',
        result: createMockResult({ summary: 'Plan ready.' }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyDesignComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0] as { message: string };
      expect(callArgs.message).toContain('Click the button below to start Phase 2.');
    });

    it('uses prompt when linearIssueTitle is not set', async () => {
      // createMockTask doesn't set linearIssueTitle by default, so it's naturally absent
      const task = createMockTask({
        prompt: 'Implement a very long prompt that should be truncated at fifty characters exactly',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyDesignComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0] as { message: string };
      // prompt.slice(0, 50) = "Implement a very long prompt that should be trunca"
      expect(callArgs.message).toContain('🎨 Design ready: Implement a very long prompt that should be trunca');
      expect(callArgs.message).not.toContain('Fix login bug'); // default task title
    });

    it('uses default summary when result has no summary', async () => {
      // Construct result without summary to test the fallback path
      const mockResult: TaskResult = { branch: 'fix/login-bug', commits: 3 };
      const task = createMockTask({
        linearIssueTitle: 'Add dark mode',
        result: mockResult,
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyDesignComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0] as { message: string };
      expect(callArgs.message).toContain('Design completed and ready for implementation.');
    });

    it('uses default summary when result is undefined', async () => {
      // createMockTask doesn't set result by default, so it's naturally absent
      const task = createMockTask({
        linearIssueTitle: 'Add dark mode',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyDesignComplete('user-123', task);

      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0] as { message: string };
      expect(callArgs.message).toContain('Design completed and ready for implementation.');
    });

    it('falls back to sending without buttons when PUBLISH_FAILED', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Add dark mode',
        result: createMockResult({ summary: 'Plan ready.' }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      // First call (with buttons) fails
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'PUBLISH_FAILED', message: 'Buttons not supported' })
      );
      // Second call (without buttons) succeeds
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyDesignComplete('user-123', task);

      expect(result.ok).toBe(true);
      expect(getPublishSendMessageMock()).toHaveBeenCalledTimes(2);
      // Fallback message should NOT say "click the button below"
      const fallbackArgs = getPublishSendMessageMock().mock.calls[1]?.[0] as { message: string; buttons?: unknown };
      expect(fallbackArgs.message).toContain('Open the web app to start Phase 2.');
      expect(fallbackArgs.message).not.toContain('Click the button below');
      expect(fallbackArgs.buttons).toBeUndefined();
    });

    it('returns error when fallback also fails', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Add dark mode',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      // First call (with buttons) fails
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'PUBLISH_FAILED', message: 'Buttons not supported' })
      );
      // Second call (without buttons) also fails
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'PUBLISH_FAILED', message: 'Service down' })
      );

      const result = await notifier.notifyDesignComplete('user-123', task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service down');
      }
    });

    it('returns error for non-PUBLISH_FAILED errors without fallback', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Add dark mode',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'TOPIC_NOT_FOUND', message: 'Topic missing' })
      );

      const result = await notifier.notifyDesignComplete('user-123', task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Topic missing');
      }
      // Should NOT attempt fallback
      expect(getPublishSendMessageMock()).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyTaskQueued', () => {
    it('sends queued notification with Linear title and ctaUrl deep link', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyTaskQueued('user-123', task, 2, 10);

      expect(result.ok).toBe(true);
      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('Task queued: Fix login bug');
      expect(callArgs.message).toContain('Position: 2');
      expect(callArgs.message).toContain('Estimated wait: ~10 minutes');
      expect(callArgs.correlationId).toBe('trace-123');
      expect(callArgs.ctaUrl).toEqual({
        displayText: 'View Progress',
        url: 'https://intexuraos.cloud/#/code-tasks/task-123',
      });
    });

    it('falls back to prompt when Linear title is missing', async () => {
      const task = createMockTask({
        prompt: 'Fix the authentication bug that causes redirect loops',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyTaskQueued('user-123', task, 1, 5);

      expect(result.ok).toBe(true);
      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('Task queued: Fix the authentication bug that causes redi');
    });

    it('returns error when publisher fails', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'PUBLISH_ERROR', message: 'Service unavailable' })
      );

      const result = await notifier.notifyTaskQueued('user-123', task, 1, 5);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service unavailable');
      }
    });
  });

  describe('notifyTaskQueueExpired', () => {
    it('sends expired notification with Linear title and ctaUrl deep link', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyTaskQueueExpired('user-123', task);

      expect(result.ok).toBe(true);
      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('Task expired in queue: Fix login bug');
      expect(callArgs.message).toContain('Workers were still busy');
      expect(callArgs.correlationId).toBe('trace-123');
      expect(callArgs.ctaUrl).toEqual({
        displayText: 'View Progress',
        url: 'https://intexuraos.cloud/#/code-tasks/task-123',
      });
    });

    it('falls back to prompt when Linear title is missing', async () => {
      const task = createMockTask({
        prompt: 'Fix the authentication bug that causes redirect loops',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyTaskQueueExpired('user-123', task);

      expect(result.ok).toBe(true);
      const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
      expect(callArgs.message).toContain('Task expired in queue: Fix the authentication bug that causes redi');
    });

    it('returns error when publisher fails', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'PUBLISH_ERROR', message: 'Service unavailable' })
      );

      const result = await notifier.notifyTaskQueueExpired('user-123', task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service unavailable');
      }
    });
  });

  describe('notifyResumedTaskComplete', () => {
    it('formats message with 🔁 emoji and session-continued prefix', async () => {
      const task = createMockTask({
        linearIssueId: 'INT-128',
        linearIssueTitle: 'Fix token refresh',
        result: createMockResult({
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/201',
          summary: 'Claude updated the token refresh logic. CI passed.',
        }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyResumedTaskComplete('user-123', task);

      const publishCall = getPublishSendMessageMock().mock.calls[0];
      const params = publishCall?.[0] as { userId: string; message: string };
      expect(params.userId).toBe('user-123');
      expect(params.message).toContain('🔁');
      expect(params.message).toContain('Session continued');
      expect(params.message).toContain('Fix token refresh');
    });

    it('includes PR URL in message and ctaUrl when present', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Update auth flow',
        result: createMockResult({
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/202',
          summary: 'Auth flow updated.',
        }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyResumedTaskComplete('user-123', task);

      const publishCall = getPublishSendMessageMock().mock.calls[0];
      const params = publishCall?.[0] as { message: string; ctaUrl?: { displayText: string; url: string } };
      expect(params.ctaUrl).toEqual({
        displayText: 'View Pull Request',
        url: 'https://github.com/pbuchman/intexuraos/pull/202',
      });
    });

    it('includes summary in message when present', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix bug',
        result: createMockResult({
          summary: 'The bug was fixed and tests pass.',
        }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyResumedTaskComplete('user-123', task);

      const publishCall = getPublishSendMessageMock().mock.calls[0];
      const params = publishCall?.[0] as { message: string };
      expect(params.message).toContain('The bug was fixed and tests pass.');
    });

    it('omits summary when result has no summary field but passes ctaUrl', async () => {
      const resultWithoutSummary: TaskResult = {
        prUrl: 'https://github.com/test/repo/pull/9',
        branch: 'fix/login',
        commits: 1,
      };
      const task = createMockTask({
        linearIssueTitle: 'Fix login',
        result: resultWithoutSummary,
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyResumedTaskComplete('user-123', task);

      const publishCall = getPublishSendMessageMock().mock.calls[0];
      const params = publishCall?.[0] as { message: string; ctaUrl?: { displayText: string; url: string } };
      expect(params.message).toContain('🔁 Session continued: Fix login');
      expect(params.message).not.toContain('PR:');
      expect(params.ctaUrl).toEqual({
        displayText: 'View Pull Request',
        url: 'https://github.com/test/repo/pull/9',
      });
    });

    it('falls back to prompt slice when no linearIssueTitle', async () => {
      const task = createMockTask({
        prompt: 'Implement the new rate limit feature for all endpoints',
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyResumedTaskComplete('user-123', task);

      const publishCall = getPublishSendMessageMock().mock.calls[0];
      const params = publishCall?.[0] as { message: string };
      expect(params.message).toContain('Implement the new rate limit feature for all end');
    });

    it('does not include fallback warning when set', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix issue',
        linearFallback: true,
      });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyResumedTaskComplete('user-123', task);

      const publishCall = getPublishSendMessageMock().mock.calls[0];
      const params = publishCall?.[0] as { message: string };
      expect(params.message).not.toContain('⚠️');
      expect(params.message).not.toContain('Linear unavailable');
    });

    it('does not include buttons but includes ctaUrl when no PR', async () => {
      const task = createMockTask({ linearIssueTitle: 'Fix issue' });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      await notifier.notifyResumedTaskComplete('user-123', task);

      const publishCall = getPublishSendMessageMock().mock.calls[0];
      const params = publishCall?.[0] as { buttons?: unknown; ctaUrl?: { displayText: string; url: string } };
      expect(params.buttons).toBeUndefined();
      expect(params.ctaUrl).toEqual({
        displayText: 'View Progress',
        url: 'https://intexuraos.cloud/#/code-tasks/task-123',
      });
    });

    it('returns ok on success', async () => {
      const task = createMockTask({ linearIssueTitle: 'Fix issue' });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

      const result = await notifier.notifyResumedTaskComplete('user-123', task);

      expect(result.ok).toBe(true);
    });

    it('returns err on publish failure', async () => {
      const task = createMockTask({ linearIssueTitle: 'Fix issue' });

      const notifier = createWhatsAppNotifier(createMockConfig());
      getPublishSendMessageMock().mockResolvedValueOnce(
        err({ code: 'PUBLISH_ERROR', message: 'Service unavailable' })
      );

      const result = await notifier.notifyResumedTaskComplete('user-123', task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service unavailable');
      }
    });
  });
});
