/**
 * Tests for WhatsAppNotifier implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { createWhatsAppNotifier } from '../../../infra/services/whatsappNotifierImpl.js';
import type { CodeTask, TaskError, TaskResult } from '../../../domain/models/codeTask.js';
import * as InternalClients from '@intexuraos/internal-clients';

// Mock fetchWithAuth
vi.mock('@intexuraos/internal-clients', async () => {
  const actual = await vi.importActual('@intexuraos/internal-clients');
  return {
    ...actual,
    fetchWithAuth: vi.fn(),
  };
});

describe('WhatsAppNotifier', () => {
  let logger: Logger;
  let mockFetchWithAuth: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockFetchWithAuth = vi.mocked(InternalClients.fetchWithAuth);
  });

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

  const createMockConfig = (): { baseUrl: string; internalAuthToken: string; logger: Logger } => ({
    baseUrl: 'http://localhost:3001',
    internalAuthToken: 'test-token',
    logger,
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

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskComplete('user-123', task);

      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.anything(),
        '/internal/messages/send',
        expect.objectContaining({
          body: expect.stringContaining('✅ Code task completed: Fix login bug'),
        })
      );

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toContain('PR: https://github.com/pbuchman/intexuraos/pull/123');
      expect(body.message).toContain('Branch: fix/login-bug');
      expect(body.message).toContain('Commits: 3');
      expect(body.message).toContain('Fixed login redirect handling');
    });

    it('formats completion message without PR URL', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        result: createMockResult({
          prUrl: undefined as unknown as string,
        }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskComplete('user-123', task);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).not.toContain('PR:');
      expect(body.message).toContain('Branch: fix/login-bug');
      expect(body.message).toContain('Commits: 3');
    });

    it('formats completion message with empty PR URL string', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        result: createMockResult({
          prUrl: '',
        }),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskComplete('user-123', task);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).not.toContain('PR:');
    });

    it('truncates long prompt when Linear title is missing', async () => {
      const longPrompt = 'Fix the bug in the authentication system that causes issues when users try to log in with invalid credentials';
      const task = createMockTask({
        prompt: longPrompt,
        // Omit linearIssueTitle to test undefined branch
        result: createMockResult({
          branch: 'fix/auth-bug',
          commits: 2,
          summary: 'Fixed auth bug',
        }),
      });
      // Remove linearIssueTitle by destructuring
      const { linearIssueTitle: _, ...taskWithoutLinearTitle } = task;

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskComplete('user-123', taskWithoutLinearTitle);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toContain('✅ Code task completed: Fix the bug in the authentication system that caus');
    });

    it('includes Linear fallback warning when linearFallback is true', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        linearFallback: true,
        result: createMockResult(),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskComplete('user-123', task);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toContain('⚠️ (Linear unavailable - no issue tracking)');
    });

    it('omits Linear fallback warning when linearFallback is false', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        linearFallback: false,
        result: createMockResult(),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskComplete('user-123', task);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).not.toContain('⚠️ (Linear unavailable');
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

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskComplete('user-123', task);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toContain('✅ Code task completed: INT-123 Fix auth bug');
      expect(body.message).not.toContain('Fix the bug in the authentication system');
    });

    it('handles completion without result', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        // result omitted to test undefined branch
      } as Partial<CodeTask> as CodeTask);

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskComplete('user-123', task);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toBe('✅ Code task completed: Fix login bug');
      expect(body.message).not.toContain('Branch:');
      expect(body.message).not.toContain('Commits:');
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

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskFailed('user-123', task, error);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toContain('❌ Code task failed: Fix login bug');
      expect(body.message).toContain('Error: Test error occurred');
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

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskFailed('user-123', task, error);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toContain('Suggestion: Check the logs');
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

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskFailed('user-123', task, error);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).not.toContain('Suggestion:');
    });

    it('omits remediation when remediation itself is undefined', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        status: 'failed',
      });
      const error = createMockError({
        message: 'Test error occurred',
        // Omit remediation to test undefined branch
      });
      const { remediation: _, ...errorWithoutRemediation } = error;

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskFailed('user-123', task, errorWithoutRemediation);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).not.toContain('Suggestion:');
    });

    it('includes Linear fallback warning when linearFallback is true', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        linearFallback: true,
        status: 'failed',
      });
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskFailed('user-123', task, error);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toContain('⚠️ (Linear unavailable - no issue tracking)');
    });

    it('omits Linear fallback warning when linearFallback is false', async () => {
      const task = createMockTask({
        linearIssueTitle: 'Fix login bug',
        linearFallback: false,
        status: 'failed',
      });
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskFailed('user-123', task, error);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).not.toContain('⚠️ (Linear unavailable');
    });

    it('truncates long prompt when Linear title is missing', async () => {
      const longPrompt = 'Fix the bug in the authentication system that causes issues when users try to log in with invalid credentials';
      const task = createMockTask({
        prompt: longPrompt,
        status: 'failed',
      });
      // Remove linearIssueTitle to test undefined branch
      const { linearIssueTitle: _, ...taskWithoutLinearTitle } = task;
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskFailed('user-123', taskWithoutLinearTitle, error);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toContain('❌ Code task failed: Fix the bug in the authentication system that caus');
    });

    it('uses Linear title when available for failure', async () => {
      const task = createMockTask({
        prompt: 'Fix the bug in the authentication system',
        linearIssueTitle: 'INT-123 Fix auth bug',
        status: 'failed',
      });
      const error = createMockError();

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      await notifier.notifyTaskFailed('user-123', task, error);

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.message).toContain('❌ Code task failed: INT-123 Fix auth bug');
      expect(body.message).not.toContain('Fix the bug in the authentication system');
    });
  });

  describe('notifyTaskComplete', () => {
    it('sends notification with correct message type', async () => {
      const task = createMockTask({
        result: createMockResult(),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      const result = await notifier.notifyTaskComplete('user-123', task);

      expect(result.ok).toBe(true);
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://localhost:3001',
          internalAuthToken: 'test-token',
        }),
        '/internal/messages/send',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.userId).toBe('user-123');
      expect(body.type).toBe('code_task_complete');
    });

    it('returns error when notification fails', async () => {
      const task = createMockTask({
        result: createMockResult(),
      });

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: false,
        error: { message: 'Service unavailable', code: 'API_ERROR' },
      });

      const result = await notifier.notifyTaskComplete('user-123', task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service unavailable');
      }
    });
  });

  describe('notifyTaskFailed', () => {
    it('sends failure notification with correct message type', async () => {
      const task = createMockTask({
        status: 'failed',
      });
      const error: TaskError = {
        code: 'test_error',
        message: 'Test error occurred',
      };

      const notifier = createWhatsAppNotifier(createMockConfig());

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: true,
        value: undefined,
      });

      const result = await notifier.notifyTaskFailed('user-123', task, error);

      expect(result.ok).toBe(true);
      const body = JSON.parse(
        (vi.mocked(mockFetchWithAuth).mock.calls[0]?.[2] as RequestInit).body as string
      );
      expect(body.userId).toBe('user-123');
      expect(body.type).toBe('code_task_failed');
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

      mockFetchWithAuth.mockResolvedValueOnce({
        ok: false,
        error: { message: 'Service unavailable', code: 'API_ERROR' },
      });

      const result = await notifier.notifyTaskFailed('user-123', task, error);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('notification_failed');
        expect(result.error.message).toBe('Service unavailable');
      }
    });
  });
});
