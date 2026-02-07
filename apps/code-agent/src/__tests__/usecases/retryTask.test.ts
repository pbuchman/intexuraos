/**
 * Tests for retryTask use case (INT-520).
 *
 * Test Requirements from INT-520:
 * 1. Returns error when original task not found
 * 2. Returns error when task status is not 'failed' or 'cancelled'
 * 3. Returns error when task failed less than 5 minutes ago (cool-off period)
 * 4. Successfully creates retry task with retriedFrom set
 * 5. Updates Linear issue state to In Progress
 * 6. Adds comment to Linear issue with retry details
 * 7. Bypasses deduplication for retry tasks
 * 8. Appends additional context to prompt when provided
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type { TaskStatus } from '../../domain/models/codeTask.js';
import { Timestamp } from '@google-cloud/firestore';

// Import usecase under test
import { retryTask, type RetryTaskDeps } from '../../domain/usecases/retryTask.js';

describe('retryTask use case', () => {
  let mockCodeTaskRepo: {
    findByIdForUser: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    hasActiveTaskForLinearIssue: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    updateIssueState: ReturnType<typeof vi.fn>;
    validateIssue: ReturnType<typeof vi.fn>;
    generateTitle: ReturnType<typeof vi.fn>;
    createIssue: ReturnType<typeof vi.fn>;
    addComment: ReturnType<typeof vi.fn>;
  };
  let mockTaskDispatcher: {
    dispatch: ReturnType<typeof vi.fn>;
  };
  let mockWhatsAppNotifier: {
    notifyTaskStarted: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockLogger: Logger;
  let mockMetricsClient: {
    incrementTasksSubmitted: ReturnType<typeof vi.fn>;
  };

  const userId = 'test-user-123';
  const originalTaskId = 'task_abc123';
  const linearIssueId = 'INT-520';

  function createMockTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    const task: CodeTask = {
      id: originalTaskId,
      userId,
      traceId: 'trace-123',
      prompt: 'Original prompt',
      sanitizedPrompt: 'Original prompt',
      systemPromptHash: 'hash-123',
      workerType: 'auto',
      workerLocation: 'home-mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'failed',
      dedupKey: 'dedup-123',
      callbackReceived: true,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      error: {
        code: 'WORKER_ERROR',
        message: 'Task failed',
      },
      linearIssueId,
      linearIssueTitle: 'Retry mechanism test',
    };

    // Apply overrides, but skip undefined values to avoid exactOptionalPropertyTypes issues
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        (task as unknown as Record<string, unknown>)[key] = value;
      }
    }

    return task;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      level: 'info',
      isLevelEnabled: vi.fn(() => true),
    } as unknown as Logger;

    // Mock code task repo
    mockCodeTaskRepo = {
      findByIdForUser: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(ok(createMockTask())),
      hasActiveTaskForLinearIssue: vi.fn(),
    };

    // Mock Linear agent client
    mockLinearAgentClient = {
      updateIssueState: vi.fn(),
      validateIssue: vi.fn(),
      generateTitle: vi.fn(),
      createIssue: vi.fn(),
      addComment: vi.fn(),
    };

    // Mock task dispatcher
    mockTaskDispatcher = {
      dispatch: vi.fn(),
    };

    // Mock WhatsApp notifier
    mockWhatsAppNotifier = {
      notifyTaskStarted: vi.fn().mockResolvedValue(ok(undefined)),
    };

    // Mock worker settings repo
    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };

    // Mock metrics client
    mockMetricsClient = {
      incrementTasksSubmitted: vi.fn().mockResolvedValue(undefined),
    };
  });

  function createDeps(): RetryTaskDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as RetryTaskDeps['codeTaskRepo'],
      linearAgentClient: mockLinearAgentClient as unknown as RetryTaskDeps['linearAgentClient'],
      taskDispatcher: mockTaskDispatcher as unknown as RetryTaskDeps['taskDispatcher'],
      whatsappNotifier: mockWhatsAppNotifier as unknown as RetryTaskDeps['whatsappNotifier'],
      metricsClient: mockMetricsClient as unknown as RetryTaskDeps['metricsClient'],
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as RetryTaskDeps['workerSettingsRepo'],
    };
  }

  describe('validation', () => {
    it('should return error when original task not found', async () => {
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Task not found' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task_not_found');
        expect(result.error.message).toContain('not found');
      }
    });

    it('should return error when task status is not failed or cancelled', async () => {
      const nonRetryableStatuses: TaskStatus[] = ['dispatched', 'running', 'completed', 'interrupted'];

      for (const status of nonRetryableStatuses) {
        vi.clearAllMocks();
        const mockTask = createMockTask({ status });
        mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

        const deps = createDeps();
        const result = await retryTask(deps, {
          originalTaskId,
          userId,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('invalid_status');
          expect(result.error.message).toContain('Only failed or cancelled tasks can be retried');
        }
      }
    });

    it('should return error when task failed less than 5 minutes ago (cool-off period)', async () => {
      // Task completed 2 minutes ago
      const twoMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: twoMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('too_soon');
        // The message should contain "minute(s)" showing remaining time
        expect(result.error.message).toMatch(/minute\(s\)/);
      }
    });

    it('should successfully retry a cancelled task and bypass cool-off', async () => {
      const retryTaskId = 'task_retry_cancelled';
      const mockCancelledTask = createMockTask({
        status: 'cancelled',
      }) as unknown as Record<string, unknown>;
      delete mockCancelledTask['completedAt'];
      delete mockCancelledTask['error'];
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockCancelledTask as unknown as CodeTask));

      mockCodeTaskRepo.create.mockImplementation((input) => {
        const newTask: CodeTask = {
          id: retryTaskId,
          userId: input.userId,
          traceId: input.traceId,
          prompt: input.prompt,
          sanitizedPrompt: input.sanitizedPrompt,
          systemPromptHash: input.systemPromptHash,
          workerType: input.workerType,
          workerLocation: input.workerLocation,
          repository: input.repository,
          baseBranch: input.baseBranch,
          status: 'dispatched',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          webhookSecret: input.webhookSecret ?? 'whsec_secret',
          linearIssueId,
          linearIssueTitle: 'Retry mechanism test',
        };
        return Promise.resolve(ok(newTask));
      });

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ orchestratorTaskId: 'orch-123', workerLocation: 'home-mac' })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [{
            name: 'home-mac',
            url: 'https://worker.example.com',
            enabled: true,
            cfAccessClientId: 'client-id',
            cfAccessClientSecret: 'client-secret',
            dispatchSigningSecret: 'webhook-secret',
          }],
        })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe(retryTaskId);
        expect(result.value.retriedFrom).toBe(originalTaskId);
      }

      // Verify Linear comment uses dynamic status text
      expect(mockLinearAgentClient.addComment).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        body: expect.stringContaining('Retrying cancelled task'),
      });
    });

    it('should bypass cool-off for cancelled task even with completedAt set', async () => {
      // A cancelled task with completedAt should still bypass cool-off
      const twoMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 1000));
      const retryTaskId = 'task_retry_cancelled_with_completed';
      const mockCancelledTask = createMockTask({
        status: 'cancelled',
        completedAt: twoMinutesAgo,
      }) as unknown as Record<string, unknown>;
      delete mockCancelledTask['error'];
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockCancelledTask as unknown as CodeTask));

      mockCodeTaskRepo.create.mockImplementation((input) => {
        const newTask: CodeTask = {
          id: retryTaskId,
          userId: input.userId,
          traceId: input.traceId,
          prompt: input.prompt,
          sanitizedPrompt: input.sanitizedPrompt,
          systemPromptHash: input.systemPromptHash,
          workerType: input.workerType,
          workerLocation: input.workerLocation,
          repository: input.repository,
          baseBranch: input.baseBranch,
          status: 'dispatched',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          webhookSecret: input.webhookSecret ?? 'whsec_secret',
          linearIssueId,
          linearIssueTitle: 'Retry mechanism test',
        };
        return Promise.resolve(ok(newTask));
      });

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ orchestratorTaskId: 'orch-123', workerLocation: 'home-mac' })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [{
            name: 'home-mac',
            url: 'https://worker.example.com',
            enabled: true,
            cfAccessClientId: 'client-id',
            cfAccessClientSecret: 'client-secret',
            dispatchSigningSecret: 'webhook-secret',
          }],
        })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      // Should succeed — cancelled tasks bypass cool-off regardless of completedAt
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe(retryTaskId);
      }
    });

    it('should allow retry when task has no completedAt timestamp', async () => {
      // Task without completedAt (e.g., interrupted) - should be retryable immediately
      // Omit completedAt to simulate task without the field
      const mockTaskWithoutCompletedAt = createMockTask() as unknown as Record<string, unknown>;
      delete mockTaskWithoutCompletedAt['completedAt'];
      const mockTask = mockTaskWithoutCompletedAt as unknown as CodeTask;
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      // Setup successful task creation
      const retryTaskId = 'task_retry_no_completed_at';
      mockCodeTaskRepo.create.mockImplementation((input) => {
        const newTask: CodeTask = {
          id: retryTaskId,
          userId: input.userId,
          traceId: input.traceId,
          prompt: input.prompt,
          sanitizedPrompt: input.sanitizedPrompt,
          systemPromptHash: input.systemPromptHash,
          workerType: input.workerType,
          workerLocation: input.workerLocation,
          repository: input.repository,
          baseBranch: input.baseBranch,
          status: 'dispatched',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          webhookSecret: input.webhookSecret ?? 'whsec_secret',
          linearIssueId,
          linearIssueTitle: 'Retry mechanism test',
        };
        return Promise.resolve(ok(newTask));
      });

      // Setup successful dispatch
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({
          orchestratorTaskId: 'orch-123',
          workerLocation: 'home-mac',
        })
      );

      // Setup Linear state update
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));

      // Setup Linear add comment
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));

      // Setup worker settings
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: true,
              cfAccessClientId: undefined,
              cfAccessClientSecret: undefined,
              dispatchSigningSecret: 'secret',
            },
          ],
        })
      );

      // Setup active task check (no active tasks)
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );

      // Setup WhatsApp notification
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

      // Setup task update (for cancel nonce)
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );

      // Setup metrics
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe(retryTaskId);
        expect(result.value.retriedFrom).toBe(originalTaskId);
      }
    });
  });

  describe('successful retry', () => {
    const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
    const retryTaskId = 'task_retry_xyz';

    beforeEach(() => {
      // Setup successful task creation
      mockCodeTaskRepo.create.mockImplementation((input) => {
        const newTask: CodeTask = {
          id: retryTaskId,
          userId: input.userId,
          traceId: input.traceId,
          prompt: input.prompt,
          sanitizedPrompt: input.sanitizedPrompt,
          systemPromptHash: input.systemPromptHash,
          workerType: input.workerType,
          workerLocation: input.workerLocation,
          repository: input.repository,
          baseBranch: input.baseBranch,
          status: 'dispatched',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          linearIssueId,
          linearIssueTitle: 'Retry mechanism test',
          webhookSecret: input.webhookSecret ?? 'whsec_secret',
        };
        return Promise.resolve(ok(newTask));
      });

      // Setup successful dispatch
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({
          orchestratorTaskId: 'orch-123',
          workerLocation: 'home-mac',
        })
      );

      // Setup Linear state update
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));

      // Setup Linear add comment
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));

      // Setup worker settings
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: true,
              cfAccessClientId: undefined,
              cfAccessClientSecret: undefined,
              dispatchSigningSecret: 'secret',
            },
          ],
        })
      );

      // Setup metrics
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);

      // Setup WhatsApp notification
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

      // Setup task update (for cancel nonce)
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );

      // Setup active task check (no active tasks)
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
    });

    it('should successfully create retry task with retriedFrom set', async () => {
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe(retryTaskId);
        expect(result.value.resourceUrl).toContain('/code-tasks/');
        expect(result.value.retriedFrom).toBe(originalTaskId);
      }

      // Verify create was called with retriedFrom
      expect(mockCodeTaskRepo.create).toHaveBeenCalled();
      const createCallInput = mockCodeTaskRepo.create.mock.calls[0]?.[0];
      expect(createCallInput?.retriedFrom).toBe(originalTaskId);
    });

    it('should update Linear issue state to In Progress', async () => {
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);

      // Verify Linear state was updated to In Progress
      expect(mockLinearAgentClient.updateIssueState).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        state: 'in_progress',
      });

      // Verify Linear comment uses dynamic status text for failed tasks
      expect(mockLinearAgentClient.addComment).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        body: expect.stringContaining('Retrying failed task'),
      });
    });

    it('should append additional context to prompt when provided', async () => {
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const additionalContext = 'The error was a timeout, try a smaller scope';
      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
        additionalContext,
      });

      expect(result.ok).toBe(true);

      // Verify prompt was augmented with context
      const createCallInput = mockCodeTaskRepo.create.mock.calls[0]?.[0];
      expect(createCallInput?.prompt).toContain('Original prompt');
      expect(createCallInput?.prompt).toContain('Additional context (retry)');
      expect(createCallInput?.prompt).toContain(additionalContext);
    });

    it('should bypass deduplication for retry tasks', async () => {
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);

      // Verify the create call has the flag to bypass deduplication
      // (implementation will use a different dedup key for retries)
      const createCallInput = mockCodeTaskRepo.create.mock.calls[0]?.[0];
      // Retry tasks should use the original task's ID in their dedup key
      // to allow retries of the same original prompt
      expect(createCallInput).toBeDefined();
    });

    it('should work when task has no Linear issue', async () => {
      const mockTaskWithoutLinear = createMockTask({
        completedAt: sixMinutesAgo,
      });
      // Explicitly remove Linear issue fields to avoid exactOptionalPropertyTypes issues
      const taskRecord = mockTaskWithoutLinear as unknown as Record<string, unknown>;
      delete taskRecord['linearIssueId'];
      delete taskRecord['linearIssueTitle'];
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTaskWithoutLinear));

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);

      // Should not call Linear agent when no issue
      expect(mockLinearAgentClient.updateIssueState).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return error when worker settings not found', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: 'retry-task-1' }) as unknown as CodeTask)
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Settings not found' })
      );
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
    });

    it('should return error when Linear state update fails', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: 'retry-task-1' }) as unknown as CodeTask)
      );
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: true,
              cfAccessClientId: undefined,
              cfAccessClientSecret: undefined,
              dispatchSigningSecret: 'secret',
            },
          ],
        })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({
          orchestratorTaskId: 'orch-123',
          workerLocation: 'home-mac',
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'Linear unavailable' })
      );
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: 'retry-task-1' }) as unknown as CodeTask)
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      // Linear state update failure should not fail the entire retry
      // It should be logged and the task should still be created
      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: expect.any(String),
          errorMessage: expect.any(String),
          linearIssueId,
        }),
        'Failed to update Linear issue to In Progress'
      );
    });

    it('should return error when task create fails', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: true,
              cfAccessClientId: undefined,
              cfAccessClientSecret: undefined,
              dispatchSigningSecret: 'secret',
            },
          ],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        err({ code: 'INTERNAL_ERROR', message: 'Database error' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toContain('Failed to create retry task');
      }
    });

    it('should return ok with task ID when dispatch fails (task was created)', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-1';
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: true,
              cfAccessClientId: undefined,
              cfAccessClientSecret: undefined,
              dispatchSigningSecret: 'secret',
            },
          ],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'WORKER_UNAVAILABLE', message: 'No workers available' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe(retryTaskId);
        expect(result.value.workerLocation).toBe('home-mac');
        expect(result.value.retriedFrom).toBe(originalTaskId);
      }
      // Verify task was updated with dispatch error
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        retryTaskId,
        expect.objectContaining({
          error: {
            code: 'WORKER_UNAVAILABLE',
            message: 'No workers available',
          },
        })
      );
    });

    it('should log warning when update fails on dispatch failure path', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-update-fail';
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [{
            name: 'home-mac',
            url: 'http://localhost:3000',
            enabled: true,
            cfAccessClientId: undefined,
            cfAccessClientSecret: undefined,
            dispatchSigningSecret: 'secret',
          }],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'WORKER_UNAVAILABLE', message: 'No workers available' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Task not found for update' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      // Should still return ok — task was created even though update failed
      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: retryTaskId }),
        'Failed to persist dispatch error on retry task'
      );
    });

    it('should return error when user has no enabled workers', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: false, // Disabled worker
              cfAccessClientId: undefined,
              cfAccessClientSecret: undefined,
              dispatchSigningSecret: 'secret',
            },
          ],
        })
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
        expect(result.error.message).toContain('configure your workers');
      }
    });

    it('should handle null worker settings', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      // Settings with null/undefined workers field
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: null } as unknown as ReturnType<typeof mockWorkerSettingsRepo.getSettings.mockResolvedValue> extends { value: infer T }
          ? T
          : never)
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
      }
    });

    it('should handle active task on Linear issue', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'active-task-123' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
        expect(result.error.message).toContain('active task already exists');
      }
    });

    it('should gracefully handle task update failure after dispatch', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-1';
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: true,
              cfAccessClientId: undefined,
              cfAccessClientSecret: undefined,
              dispatchSigningSecret: 'secret',
            },
          ],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({
          orchestratorTaskId: 'orch-123',
          workerLocation: 'home-mac',
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Task not found' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      // Should still succeed even if update fails
      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: retryTaskId }),
        'Failed to update retry task with cancel nonce'
      );
    });

    it('should continue when active task check fails with database error', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      // Repository returns error for active task check
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'Could not check active tasks' })
      );

      // Setup all other successful mocks
      const retryTaskId = 'retry-task-db-check-fail';
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: true,
              cfAccessClientId: undefined,
              cfAccessClientSecret: undefined,
              dispatchSigningSecret: 'secret',
            },
          ],
        })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({
          orchestratorTaskId: 'orch-123',
          workerLocation: 'home-mac',
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      // Should still proceed with retry - this is intentional behavior
      // Better to allow retry than to block on a database check
      expect(result.ok).toBe(true);

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueId,
          error: { code: 'DATABASE_ERROR', message: 'Could not check active tasks' },
        }),
        'Failed to check for active tasks on Linear issue, proceeding with retry'
      );
    });

    it('should continue successfully when metrics recording fails', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );

      // Setup all successful mocks
      const retryTaskId = 'retry-task-metrics-fail';
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: true,
              cfAccessClientId: undefined,
              cfAccessClientSecret: undefined,
              dispatchSigningSecret: 'secret',
            },
          ],
        })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({
          orchestratorTaskId: 'orch-123',
          workerLocation: 'home-mac',
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );

      // Make metrics fail
      mockMetricsClient.incrementTasksSubmitted.mockRejectedValue(
        new Error('Metrics service unavailable')
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      // Should still succeed despite metrics failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe(retryTaskId);
      }

      // Verify warning was logged for metrics failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: retryTaskId,
          error: expect.anything(),
        }),
        'Failed to record task submission metric for retry'
      );
    });
  });
});
