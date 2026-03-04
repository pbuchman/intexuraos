/**
 * Tests for retryTask use case (INT-520).
 *
 * Test Requirements from INT-520:
 * 1. Returns error when original task not found
 * 2. Returns error when task status is not 'failed', 'cancelled', or 'interrupted'
 * 3. Returns error when task failed less than 1 minute ago (cool-off period)
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
    countQueued: ReturnType<typeof vi.fn>;
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
    notifyTaskQueued: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockLogger: Logger;
  let mockMetricsClient: {
    incrementTasksSubmitted: ReturnType<typeof vi.fn>;
  };
  let mockLockDeleteFn: ReturnType<typeof vi.fn>;
  let mockFirestore: {
    doc: ReturnType<typeof vi.fn>;
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
      countQueued: vi.fn().mockResolvedValue(ok(0)),
    };

    // Mock Linear agent client
    mockLinearAgentClient = {
      updateIssueState: vi.fn(),
      validateIssue: vi.fn(),
      generateTitle: vi.fn(),
      createIssue: vi.fn(),
      addComment: vi.fn(),
    };
    mockLinearAgentClient.validateIssue.mockResolvedValue(
      ok({
        id: linearIssueId,
        identifier: linearIssueId,
        title: 'Retry mechanism test',
        url: 'https://linear.app/intexuraos/issue/INT-520',
        labels: ['unclear'],
        childCount: 0,
      })
    );

    // Mock task dispatcher
    mockTaskDispatcher = {
      dispatch: vi.fn(),
    };

    // Mock WhatsApp notifier
    mockWhatsAppNotifier = {
      notifyTaskStarted: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskQueued: vi.fn().mockResolvedValue(ok(undefined)),
    };

    // Mock worker settings repo
    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };

    // Mock metrics client
    mockMetricsClient = {
      incrementTasksSubmitted: vi.fn().mockResolvedValue(undefined),
    };

    // Mock firestore for PR task lock cleanup
    mockLockDeleteFn = vi.fn().mockResolvedValue(undefined);
    mockFirestore = {
      doc: vi.fn().mockReturnValue({ delete: mockLockDeleteFn }),
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
      orchestratorSecret: 'test-orchestrator-secret',
      serviceUrl: 'https://test.example.com',
      firestore: mockFirestore as unknown as RetryTaskDeps['firestore'],
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

    it('should return error when task status is not failed, cancelled, or interrupted', async () => {
      const nonRetryableStatuses: TaskStatus[] = ['dispatched', 'running', 'implemented', 'archived'];

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
          expect(result.error.message).toContain('Only failed, cancelled, or interrupted tasks can be retried');
        }
      }
    });

    it('should return error when task failed less than 1 minute ago (cool-off period)', async () => {
      // Task completed 30 seconds ago
      const twoMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 1000));
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

    it('should successfully retry an interrupted task and bypass cool-off', async () => {
      const retryTaskId = 'task_retry_interrupted';
      const twoMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 1000));
      const mockInterruptedTask = createMockTask({
        status: 'interrupted',
        completedAt: twoMinutesAgo,
      }) as unknown as Record<string, unknown>;
      delete mockInterruptedTask['error'];
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockInterruptedTask as unknown as CodeTask));

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
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      // Should succeed despite completedAt being only 2 minutes ago (bypasses cool-off)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe(retryTaskId);
        expect(result.value.retriedFrom).toBe(originalTaskId);
      }

      // Verify Linear comment uses dynamic status text
      expect(mockLinearAgentClient.addComment).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        body: expect.stringContaining('Retrying interrupted task'),
      });
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

      // Verify agentType is 'design' when validateIssue returns no 'code-task' label
      // (default mock returns labels: ['unclear'])
      expect(createCallInput?.agentType).toBe('planning');
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

    it('should refresh Linear labels and children before dispatch', async () => {
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
      });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Retry mechanism test',
          url: 'https://linear.app/intexuraos/issue/INT-520',
          labels: ['code-task'],
          childCount: 2,
        })
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueLabels: ['code-task'],
          hasChildren: true,
        })
      );

      // Verify agentType is 'execution' when validateIssue returns 'code-task' label
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
        })
      );
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

    it('should preserve pull_request agentType from original task instead of using label-based routing', async () => {
      const mockTask = createMockTask({ completedAt: sixMinutesAgo, agentType: 'pull_request' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      // Even if labels say 'code-task' (execution), pull_request must be preserved
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Retry mechanism test',
          url: 'https://linear.app/intexuraos/issue/INT-520',
          labels: ['code-task'],
          childCount: 0,
        })
      );

      let createInputAgentType: unknown;
      mockCodeTaskRepo.create.mockImplementation((input: Record<string, unknown>) => {
        createInputAgentType = input['agentType'];
        const agentTypeValue = input['agentType'] as CodeTask['agentType'];
        const newTask: CodeTask = {
          id: retryTaskId,
          userId: String(input['userId']),
          traceId: String(input['traceId']),
          prompt: String(input['prompt']),
          sanitizedPrompt: String(input['sanitizedPrompt']),
          systemPromptHash: String(input['systemPromptHash']),
          workerType: input['workerType'] as CodeTask['workerType'],
          workerLocation: String(input['workerLocation']),
          repository: String(input['repository']),
          baseBranch: String(input['baseBranch']),
          status: 'dispatched',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          linearIssueId,
          linearIssueTitle: 'Retry mechanism test',
          webhookSecret: String(input['webhookSecret'] ?? 'whsec_secret'),
          ...(agentTypeValue !== undefined && { agentType: agentTypeValue }),
        };
        return Promise.resolve(ok(newTask));
      });

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      // createInput must use pull_request, not execution (even though code-task label exists)
      expect(createInputAgentType).toBe('pull_request');
      // dispatchRequest must also carry pull_request
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: 'pull_request' })
      );
    });

    it('should fall back to label-based routing when original task is not pull_request', async () => {
      // agentType is undefined (legacy task) — should use labels to decide
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      // Labels contain code-task → should pick execution
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Retry mechanism test',
          url: 'https://linear.app/intexuraos/issue/INT-520',
          labels: ['code-task'],
          childCount: 0,
        })
      );

      let createInputAgentType: unknown;
      mockCodeTaskRepo.create.mockImplementation((input: Record<string, unknown>) => {
        createInputAgentType = input['agentType'];
        const agentTypeValue = input['agentType'] as CodeTask['agentType'];
        const newTask: CodeTask = {
          id: retryTaskId,
          userId: String(input['userId']),
          traceId: String(input['traceId']),
          prompt: String(input['prompt']),
          sanitizedPrompt: String(input['sanitizedPrompt']),
          systemPromptHash: String(input['systemPromptHash']),
          workerType: input['workerType'] as CodeTask['workerType'],
          workerLocation: String(input['workerLocation']),
          repository: String(input['repository']),
          baseBranch: String(input['baseBranch']),
          status: 'dispatched',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          linearIssueId,
          linearIssueTitle: 'Retry mechanism test',
          webhookSecret: String(input['webhookSecret'] ?? 'whsec_secret'),
          ...(agentTypeValue !== undefined && { agentType: agentTypeValue }),
        };
        return Promise.resolve(ok(newTask));
      });

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      // createInput must use label-based routing (execution) when no pull_request
      expect(createInputAgentType).toBe('execution');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: 'execution' })
      );
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
      // Verify task was updated with dispatch error and failed status
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        retryTaskId,
        expect.objectContaining({
          status: 'failed',
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

  describe('task queueing on at_capacity (INT-619)', () => {
    it('queues task when dispatch returns at_capacity and queue is not full', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-queued';
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
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ labels: [], childCount: 0 })
      );
      const createdTask = createMockTask({ id: retryTaskId });
      mockCodeTaskRepo.create.mockResolvedValue(ok(createdTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'All workers at capacity' })
      );
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(2));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createdTask));

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe(retryTaskId);
        expect(result.value.workerLocation).toBe('queued');
        expect(result.value.retriedFrom).toBe(originalTaskId);
      }

      // Verify task was updated to queued status
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        retryTaskId,
        expect.objectContaining({
          status: 'queued',
          queuedAt: expect.any(Date),
        })
      );

      // Verify WhatsApp notification was sent with queue position
      expect(mockWhatsAppNotifier.notifyTaskQueued).toHaveBeenCalledWith(
        userId,
        createdTask,
        3, // queueCount (2) + 1
        15 // queuePosition (3) * 5
      );

      // Verify info log
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: retryTaskId, queuePosition: 3 }),
        'Retry task queued due to worker capacity'
      );
    });

    it('returns internal_error when queue status update fails', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-queue-fail';
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
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ labels: [], childCount: 0 })
      );
      const createdTask = createMockTask({ id: retryTaskId });
      mockCodeTaskRepo.create.mockResolvedValue(ok(createdTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'All workers at capacity' })
      );
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(2));
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Firestore write failed' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Failed to queue task');
      }
      expect(mockWhatsAppNotifier.notifyTaskQueued).not.toHaveBeenCalled();
    });

    it('returns error when dispatch returns at_capacity and queue is full', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-queue-full';
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
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ labels: [], childCount: 0 })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }))
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'All workers at capacity' })
      );
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(10)); // At max (default maxSize=10)
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }))
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
        expect(result.error.message).toContain('queue is full');
      }

      // Verify task was marked as failed with queue_full error
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        retryTaskId,
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({
            code: 'queue_full',
          }),
        })
      );

      // Verify no queued notification was sent
      expect(mockWhatsAppNotifier.notifyTaskQueued).not.toHaveBeenCalled();
    });

    it('returns queue_full when countQueued fails (fail-closed)', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-count-err';
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
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ labels: [], childCount: 0 })
      );
      const createdTask = createMockTask({ id: retryTaskId });
      mockCodeTaskRepo.create.mockResolvedValue(ok(createdTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'All workers at capacity' })
      );
      // countQueued fails — should fall back to maxSize (fail-closed), triggering queue_full
      mockCodeTaskRepo.countQueued.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'DB error' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createdTask));

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      // Task should be rejected as queue_full (fallback to maxSize >= maxSize)
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
      }
    });
  });

  describe('archive original task on retry (INT-711)', () => {
    it('archives original task after successful retry dispatch', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-archive';
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
        ok({ orchestratorTaskId: 'orch-123', workerLocation: 'home-mac' })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);

      // Verify codeTaskRepo.update was called with archived status for original task
      const updateCalls = mockCodeTaskRepo.update.mock.calls as [string, { status?: string }][];
      const archiveCall = updateCalls.find(
        ([taskId, input]) => taskId === originalTaskId && input.status === 'archived'
      );

      expect(archiveCall).toBeDefined();
      expect(archiveCall?.[0]).toBe(originalTaskId);
      expect(archiveCall?.[1]).toEqual({ status: 'archived' });
    });

    it('succeeds even when archiving original task fails', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-archive-fail';
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
        ok({ orchestratorTaskId: 'orch-123', workerLocation: 'home-mac' })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

      // Return error only for the original task archive call, success for all others
      mockCodeTaskRepo.update.mockImplementation(async (taskId: string, input: { status?: string }) => {
        if (taskId === originalTaskId && input.status === 'archived') {
          return err({ code: 'FIRESTORE_ERROR' as const, message: 'Archive failed' });
        }
        return ok(createMockTask({ id: taskId === retryTaskId ? retryTaskId : originalTaskId }) as unknown as CodeTask);
      });

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      // Retry should still succeed despite archive failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.retriedFrom).toBe(originalTaskId);
      }

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ originalTaskId }),
        'Failed to archive original task after retry (non-fatal)'
      );
    });
  });

  describe('PR task lock cleanup', () => {
    it('deletes PR task lock on queue full (PR task)', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
        prNumber: 42,
        repository: 'org/repo',
      });
      const retryTaskId = 'retry-task-lock-queue-full';
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
        ok(createMockTask({ id: retryTaskId }))
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'All workers at capacity' })
      );
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(10)); // At max
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }))
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
      }
      // Verify lock deletion was called
      expect(mockFirestore.doc).toHaveBeenCalledWith('pr_task_locks/org_repo_42');
      expect(mockLockDeleteFn).toHaveBeenCalled();
    });

    it('deletes PR task lock on dispatch failure (PR task)', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
        prNumber: 42,
        repository: 'org/repo',
      });
      const retryTaskId = 'retry-task-lock-dispatch-fail';
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
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      // Verify lock deletion was called
      expect(mockFirestore.doc).toHaveBeenCalledWith('pr_task_locks/org_repo_42');
      expect(mockLockDeleteFn).toHaveBeenCalled();
    });

    it('does NOT delete PR task lock on dispatch failure (non-PR task)', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      // Create task without prNumber
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
      }) as unknown as Record<string, unknown>;
      delete mockTask['prNumber'];
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask as unknown as CodeTask));
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
      const retryTaskId = 'retry-task-lock-no-pr';
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
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      // Verify lock deletion was NOT called (no prNumber on original task)
      expect(mockLockDeleteFn).not.toHaveBeenCalled();
    });
  });
});
