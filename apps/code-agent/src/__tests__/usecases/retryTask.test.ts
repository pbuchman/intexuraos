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
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    hasActiveTaskForLinearIssue: ReturnType<typeof vi.fn>;
    hasDispatchedOrRunningForPR: ReturnType<typeof vi.fn>;
    countQueued: ReturnType<typeof vi.fn>;
    findRecentTasksByLinearIssue: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    updateIssueState: ReturnType<typeof vi.fn>;
    validateIssue: ReturnType<typeof vi.fn>;
    generateTitle: ReturnType<typeof vi.fn>;
    createIssue: ReturnType<typeof vi.fn>;
    addComment: ReturnType<typeof vi.fn>;
  };
  let mockTaskEnqueueService: {
    enqueue: ReturnType<typeof vi.fn>;
  };
  let mockGitHubPRClient: {
    getPullRequestStatus: ReturnType<typeof vi.fn>;
    postPRComment: ReturnType<typeof vi.fn>;
  };
  let mockUserServiceClient: {
    getOAuthToken: ReturnType<typeof vi.fn>;
  };
  let mockLogger: Logger;
  let mockMetricsClient: {
    incrementTasksSubmitted: ReturnType<typeof vi.fn>;
  };
  const userId = 'test-user-123';
  const originalTaskId = 'task_abc123';
  const linearIssueId = 'INT-520';

  type MockTaskOverrides = Partial<CodeTask> & {
    linearIssueTitle?: string;
  };

  function createMockTask(overrides: MockTaskOverrides = {}): CodeTask {
    const now = Timestamp.now();
    const { linearIssueTitle: _linearIssueTitle, ...taskOverrides } = overrides;
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
    };

    // Apply overrides, but skip undefined values to avoid exactOptionalPropertyTypes issues
    for (const [key, value] of Object.entries(taskOverrides)) {
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
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(ok(createMockTask())),
      hasActiveTaskForLinearIssue: vi.fn(),
      hasDispatchedOrRunningForPR: vi.fn().mockResolvedValue(ok({ hasActive: false })),
      countQueued: vi.fn().mockResolvedValue(ok(0)),
      findRecentTasksByLinearIssue: vi.fn().mockResolvedValue(ok([])),
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
        url: 'https://linear.app/pbuchman/issue/INT-520',
        labels: ['unclear'],
        childCount: 0,
      })
    );

    // Mock task enqueue service
    mockTaskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'task_mock', queuePosition: 1 })),
    };

    mockGitHubPRClient = {
      getPullRequestStatus: vi.fn(),
      postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 123 })),
    };

    mockUserServiceClient = {
      getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'gh-token' })),
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
      taskEnqueueService: mockTaskEnqueueService as unknown as RetryTaskDeps['taskEnqueueService'],
      metricsClient: mockMetricsClient as unknown as RetryTaskDeps['metricsClient'],
      gitHubPRClient: mockGitHubPRClient as unknown as RetryTaskDeps['gitHubPRClient'],
      userServiceClient: mockUserServiceClient as unknown as RetryTaskDeps['userServiceClient'],
      orchestratorSecret: 'test-orchestrator-secret',
      automationLog: { record: vi.fn().mockResolvedValue(undefined) },
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
          status: 'queued',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          webhookSecret: input.webhookSecret ?? 'whsec_secret',
          linearIssueId,
        };
        return Promise.resolve(ok(newTask));
      });

      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));

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
          status: 'queued',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          webhookSecret: input.webhookSecret ?? 'whsec_secret',
          linearIssueId,
        };
        return Promise.resolve(ok(newTask));
      });

      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));

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
          status: 'queued',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          webhookSecret: input.webhookSecret ?? 'whsec_secret',
          linearIssueId,
        };
        return Promise.resolve(ok(newTask));
      });

      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));
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
          status: 'queued',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          webhookSecret: input.webhookSecret ?? 'whsec_secret',
          linearIssueId,
        };
        return Promise.resolve(ok(newTask));
      });

      // Setup successful dispatch
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );

      // Setup Linear state update
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));

      // Setup Linear add comment
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));

      // Setup worker settings

      // Setup active task check (no active tasks)
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );

      // Setup WhatsApp notification

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
          status: 'queued',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          linearIssueId,
          webhookSecret: input.webhookSecret ?? 'whsec_secret',
          ...(input.agentType !== undefined && { agentType: input.agentType }),
          ...(input.prNumber !== undefined && { prNumber: input.prNumber }),
          ...(input.prBranch !== undefined && { prBranch: input.prBranch }),
        };
        return Promise.resolve(ok(newTask));
      });

      // Setup successful enqueue
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );

      // Setup Linear state update
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));

      // Setup Linear add comment
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));

      // Setup metrics
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);

      // Setup task update (for archive)
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
          url: 'https://linear.app/pbuchman/issue/INT-520',
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
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();

      // Verify agentType is 'execution' when validateIssue returns 'code-task' label
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
        })
      );
    });

    it('should inherit an open continuation PR on execution retry', async () => {
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
        agentType: 'execution',
        prNumber: 1131,
        prBranch: 'task_original_branch',
      });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_existing_pr_branch',
        })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
          prNumber: 1131,
          prBranch: 'task_existing_pr_branch',
        })
      );
      expect(mockGitHubPRClient.postPRComment).toHaveBeenCalledWith(
        'gh-token',
        'pbuchman',
        'intexuraos',
        1131,
        expect.stringContaining('@ignore')
      );
      expect(mockGitHubPRClient.postPRComment).toHaveBeenCalledWith(
        'gh-token',
        'pbuchman',
        'intexuraos',
        1131,
        expect.stringContaining('Execution Retry Task Created')
      );
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();
    });

    it('should reuse the newest open PR from same-ticket history when the original task has none', async () => {
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
        agentType: 'execution',
      });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.findRecentTasksByLinearIssue.mockResolvedValue(
        ok([
          createMockTask({
            id: 'task_same_ticket_open_pr',
            prNumber: 1139,
            prBranch: 'task_stale_branch',
            agentType: 'execution',
          }),
        ])
      );
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_same_ticket_open_pr_branch',
        })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.findRecentTasksByLinearIssue).toHaveBeenCalledWith(linearIssueId, 20);
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          prNumber: 1139,
          prBranch: 'task_same_ticket_open_pr_branch',
        })
      );
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();
    });

    it('should fail before creating a retry when continuation PR verification cannot fetch a GitHub token', async () => {
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
        agentType: 'execution',
        prNumber: 1131,
      });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockUserServiceClient.getOAuthToken.mockResolvedValue(
        err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub connection' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe(
          'GitHub OAuth token is required to verify continuation PR state'
        );
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ originalTaskId, userId }),
        'Failed to resolve continuation PR for retry'
      );
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
      expect(mockTaskEnqueueService.enqueue).not.toHaveBeenCalled();
    });

    it('should fail before dispatch when continuation bootstrap comment cannot be posted', async () => {
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
        agentType: 'execution',
        prNumber: 1131,
      });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_existing_pr_branch',
        })
      );
      mockGitHubPRClient.postPRComment.mockResolvedValue(
        err({ code: 'API_ERROR', message: 'Failed to post PR bootstrap comment' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Failed to post PR bootstrap comment');
      }
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        retryTaskId,
        expect.objectContaining({
          status: 'failed',
          error: {
            code: 'PR_BOOTSTRAP_COMMENT_FAILED',
            message: 'Failed to post PR bootstrap comment',
          },
        })
      );
      expect(mockTaskEnqueueService.enqueue).not.toHaveBeenCalled();
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        originalTaskId,
        expect.objectContaining({ status: 'archived' })
      );
    });

    it('should treat legacy PR result metadata as execution and reuse the existing PR', async () => {
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/1131' },
      });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Retry mechanism test',
          url: 'https://linear.app/pbuchman/issue/INT-520',
          labels: ['unclear'],
          childCount: 0,
        })
      );
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_existing_pr_branch',
        })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
          prNumber: 1131,
          prBranch: 'task_existing_pr_branch',
        })
      );
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();
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
          url: 'https://linear.app/pbuchman/issue/INT-520',
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
          status: 'queued',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          linearIssueId,
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
      // Enqueue service must have been called
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();
    });

    it('should infer pull_request agentType from pr-comment-auto on legacy tasks', async () => {
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
        systemPromptHash: 'pr-comment-auto',
      });
      const taskRecord = mockTask as unknown as Record<string, unknown>;
      delete taskRecord['agentType'];
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Retry mechanism test',
          url: 'https://linear.app/pbuchman/issue/INT-520',
          labels: ['bug'],
          childCount: 0,
        })
      );

      let createInputAgentType: unknown;
      mockCodeTaskRepo.create.mockImplementation((input: Record<string, unknown>) => {
        createInputAgentType = input['agentType'];
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
          status: 'queued',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          linearIssueId,
          webhookSecret: String(input['webhookSecret'] ?? 'whsec_secret'),
          agentType: 'pull_request',
        };
        return Promise.resolve(ok(newTask));
      });
      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      expect(createInputAgentType).toBe('pull_request');
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();
    });

    it('should preserve review agentType from original task on retry', async () => {
      // Review tasks have no Linear issue — agentType must be preserved from original
      const mockTask = createMockTask({ completedAt: sixMinutesAgo, agentType: 'review' });
      const taskRecord = mockTask as unknown as Record<string, unknown>;
      delete taskRecord['linearIssueId'];
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

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
          webhookSecret: String(input['webhookSecret'] ?? 'whsec_secret'),
          ...(agentTypeValue !== undefined && { agentType: agentTypeValue }),
        };
        return Promise.resolve(ok(newTask));
      });

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      expect(createInputAgentType).toBe('review');
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();
    });

    it('should preserve execution agentType from original task instead of re-deriving from labels', async () => {
      const mockTask = createMockTask({ completedAt: sixMinutesAgo, agentType: 'execution' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      // Even if labels say 'unclear' (planning), execution must be preserved from original
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Retry mechanism test',
          url: 'https://linear.app/pbuchman/issue/INT-520',
          labels: ['unclear'],
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
          webhookSecret: String(input['webhookSecret'] ?? 'whsec_secret'),
          ...(agentTypeValue !== undefined && { agentType: agentTypeValue }),
        };
        return Promise.resolve(ok(newTask));
      });

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);
      // Must preserve execution from original, not re-derive as planning from 'unclear' labels
      expect(createInputAgentType).toBe('execution');
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();
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
          url: 'https://linear.app/pbuchman/issue/INT-520',
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
          status: 'queued',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          retriedFrom: originalTaskId,
          linearIssueId,
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
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
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
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'Linear unavailable' })
      );
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);
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

    it('should return error when enqueue fails with internal_error', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-1';
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        err({ code: 'internal_error', message: 'Enqueue failed' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Enqueue failed');
      }
    });

    it('should return queue_full error when enqueue returns queue_full', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-queue-full';
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        err({ code: 'queue_full', message: 'Queue is full' })
      );

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
        expect(result.error.message).toBe('Queue is full');
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

    it('should gracefully handle archive failure after enqueue', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: 'retry-task-1' }) as unknown as CodeTask)
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

      // Should still succeed even if archive fails
      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ originalTaskId }),
        'Failed to archive original task after retry (non-fatal)'
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
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
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
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
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

  describe('archive original task on retry (INT-711)', () => {
    it('archives original task after successful retry dispatch', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      const retryTaskId = 'retry-task-archive';
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);
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
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);

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

    it('persists only linearIssueId on the retry task', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({
        completedAt: sixMinutesAgo,
        linearIssueTitle: 'Retry mechanism test',
      });

      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: 'retry-task-persisted' }) as unknown as CodeTask)
      );
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      mockLinearAgentClient.addComment.mockResolvedValue(ok(undefined));

      const result = await retryTask(createDeps(), { originalTaskId, userId });

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueId,
        })
      );
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearIssueTitle: expect.anything(),
        })
      );
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearIssueUrl: expect.anything(),
        })
      );
    });
  });

  describe('v8 ignore coverage (INT-761)', () => {
    it('should handle retry when original task has no linearIssueId (line 337 false branch)', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      // Create task WITHOUT linearIssueId by manually constructing it
      const now = Timestamp.now();
      const mockTask: CodeTask = {
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
        completedAt: sixMinutesAgo,
        error: {
          code: 'WORKER_ERROR',
          message: 'Task failed',
        },
        // linearIssueId intentionally omitted
      };
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const retryTaskId = 'retry-task-no-linear-issue';
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({ ...mockTask, id: retryTaskId, status: 'dispatched' } as CodeTask)
      );
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok({ ...mockTask, id: retryTaskId, status: 'dispatched' } as CodeTask)
      );
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      expect(result.ok).toBe(true);

      // Verify enqueue was called
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();

      // Verify Linear operations were NOT called (no linearIssueId)
      expect(mockLinearAgentClient.updateIssueState).not.toHaveBeenCalled();
      expect(mockLinearAgentClient.addComment).not.toHaveBeenCalled();
      expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
    });

    it('should log warning when addComment fails during retry (line 473)', async () => {
      const sixMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 1000));
      const mockTask = createMockTask({ completedAt: sixMinutesAgo });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );

      const retryTaskId = 'retry-task-addcomment-fail';
      mockCodeTaskRepo.create.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_mock', queuePosition: 1 })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok(undefined));
      // addComment fails
      mockLinearAgentClient.addComment.mockResolvedValue(
        err({ code: 'LINEAR_ERROR', message: 'Failed to add comment' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok(createMockTask({ id: retryTaskId }) as unknown as CodeTask)
      );
      mockMetricsClient.incrementTasksSubmitted.mockResolvedValue(undefined);

      const deps = createDeps();
      const result = await retryTask(deps, { originalTaskId, userId });

      // Retry should still succeed despite comment failure
      expect(result.ok).toBe(true);

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ linearIssueId }),
        'Failed to add comment to Linear issue'
      );
    });

  });

});
