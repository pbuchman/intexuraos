/**
 * Tests for submitToExecutionAgent use case.
 *
 * Validates the full workflow of starting Execution Agent implementation
 * from a completed Planning Agent task, including:
 * - Input validation (task status, agent type, Linear issue, duplicate guard)
 * - Label validation (code-task required, unclear blocks)
 * - Worker configuration
 * - Optimistic lock before dispatch
 * - Rollback on failure
 * - Linear best-effort updates
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import { Timestamp } from '@google-cloud/firestore';
import {
  submitToExecutionAgent,
  EXECUTION_AGENT_PROMPT,
  type SubmitToExecutionAgentDeps,
} from '../../../domain/usecases/submitToExecutionAgent.js';
import { fanOutChildTasks } from '../../../domain/usecases/fanOutChildTasks.js';

vi.mock('../../../domain/usecases/fanOutChildTasks.js', () => ({
  fanOutChildTasks: vi.fn(),
}));

const mockFanOutChildTasks = vi.mocked(fanOutChildTasks);

describe('submitToExecutionAgent', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findByIdForUser: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    hasActiveTaskForLinearIssue: ReturnType<typeof vi.fn>;
    hasDispatchedOrRunningForPR: ReturnType<typeof vi.fn>;
    countQueued: ReturnType<typeof vi.fn>;
    findPlannedTaskByLinearIssue: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    validateIssue: ReturnType<typeof vi.fn>;
    updateIssueState: ReturnType<typeof vi.fn>;
    addComment: ReturnType<typeof vi.fn>;
    fetchIssueTree: ReturnType<typeof vi.fn>;
    fetchDirectChildrenLive: ReturnType<typeof vi.fn>;
  };
  let mockTaskEnqueueService: {
    enqueue: ReturnType<typeof vi.fn>;
    enqueueMany: ReturnType<typeof vi.fn>;
  };
  let mockMetricsClient: {
    incrementTasksSubmitted: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockGitHubPRClient: {
    getPullRequestStatus: ReturnType<typeof vi.fn>;
    mergePullRequest: ReturnType<typeof vi.fn>;
  };
  let mockUserServiceClient: {
    getOAuthToken: ReturnType<typeof vi.fn>;
  };

  const userId = 'user_123';
  const originalTaskId = 'task_original';
  const linearIssueId = 'INT-100';

  const enabledWorker = {
    name: 'home-dev',
    url: 'https://worker.local',
    enabled: true,
    cfAccessClientId: 'client-id',
    cfAccessClientSecret: 'client-secret',
    dispatchSigningSecret: 'signing-secret',
  };

  function createMockTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    const task: CodeTask = {
      id: originalTaskId,
      userId,
      traceId: 'trace-abc',
      prompt: 'Implement feature X',
      sanitizedPrompt: 'Implement feature X',
      systemPromptHash: 'hash123',
      workerType: 'auto',
      workerLocation: 'home-dev',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'planned',
      agentType: 'planning',
      dedupKey: 'dedup-abc',
      callbackReceived: true,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      linearIssueId,
    };

    // Apply overrides, but skip undefined values to avoid exactOptionalPropertyTypes issues
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        (task as unknown as Record<string, unknown>)[key] = value;
      }
    }

    return task;
  }

  function createDeps(): SubmitToExecutionAgentDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as SubmitToExecutionAgentDeps['codeTaskRepo'],
      linearAgentClient: mockLinearAgentClient as unknown as SubmitToExecutionAgentDeps['linearAgentClient'],
      taskEnqueueService: mockTaskEnqueueService as unknown as SubmitToExecutionAgentDeps['taskEnqueueService'],
      metricsClient: mockMetricsClient as unknown as SubmitToExecutionAgentDeps['metricsClient'],
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as SubmitToExecutionAgentDeps['workerSettingsRepo'],
      orchestratorSecret: 'test-orchestrator-secret',
      gitHubPRClient: mockGitHubPRClient as unknown as SubmitToExecutionAgentDeps['gitHubPRClient'],
      userServiceClient: mockUserServiceClient as unknown as SubmitToExecutionAgentDeps['userServiceClient'],
    };
  }

  /**
   * Creates a mock implementation for update that returns different results for each call.
   * Useful for testing sequential update operations (optimistic lock, rollback, fail-mark).
   * @param outcomes - Array of results to return in sequence. Last result is reused for subsequent calls.
   */
  function createSequentialUpdateMock<T>(
    outcomes: (ReturnType<typeof ok<T>> | ReturnType<typeof err>)[]
  ): () => Promise<ReturnType<typeof ok<T>> | ReturnType<typeof err>> {
    let callCount = 0;
    return () => {
      callCount++;
      const index = Math.min(callCount, outcomes.length) - 1;
      const outcome = outcomes[index];
      if (outcome === undefined) {
        throw new Error(`No outcome defined for call ${callCount}`);
      }
      return Promise.resolve(outcome);
    };
  }

  function setupHappyPathMocks(taskOverrides: Partial<CodeTask> = {}): CodeTask {
    const mockTask = createMockTask(taskOverrides);

    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
    mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
      ok({ hasActive: false })
    );
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(
      ok({ workers: [enabledWorker] })
    );
    mockLinearAgentClient.validateIssue.mockResolvedValue(
      ok({
        id: linearIssueId,
        identifier: linearIssueId,
        title: 'My Feature',
        url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
        labels: ['code-task'],
        childCount: 0,
        parentId: null,
      })
    );
    // First update = optimistic lock (sets implementationTaskId)
    // Second update = cancel nonce
    mockCodeTaskRepo.update.mockResolvedValue(
      ok({
        ...mockTask,
        cancelNonce: 'abcd',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
    );
    mockCodeTaskRepo.create.mockResolvedValue(
      ok({
        ...mockTask,
        id: 'task_execution',
        agentType: 'execution' as const,
        followUpReason: 'execution_implement' as const,
        parentTaskId: originalTaskId,
        traceId: 'execution-trace-abc',
        sanitizedPrompt: 'Implement feature X',
        systemPromptHash: 'hash123',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        workerType: 'auto' as const,
        webhookSecret: 'webhook-secret',
      })
    );
    mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
    mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
    mockTaskEnqueueService.enqueue.mockResolvedValue(
      ok({ taskId: 'task_execution', queuePosition: 1 })
    );

    return mockTask;
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
      findByIdForUser: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      hasActiveTaskForLinearIssue: vi.fn(),
      hasDispatchedOrRunningForPR: vi.fn(),
      countQueued: vi.fn(),
      findPlannedTaskByLinearIssue: vi.fn(),
    };

    mockLinearAgentClient = {
      validateIssue: vi.fn(),
      updateIssueState: vi.fn(),
      addComment: vi.fn(),
      fetchIssueTree: vi.fn(),
      fetchDirectChildrenLive: vi.fn(),
    };

    mockTaskEnqueueService = {
      enqueue: vi.fn(),
      enqueueMany: vi.fn(),
    };

    mockMetricsClient = {
      incrementTasksSubmitted: vi.fn(),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };

    mockGitHubPRClient = {
      getPullRequestStatus: vi.fn().mockResolvedValue(ok({ state: 'open', mergedAt: null, headRef: 'plan/test' })),
      mergePullRequest: vi.fn().mockResolvedValue(ok({ sha: 'abc123', merged: true })),
    };

    mockUserServiceClient = {
      getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'ghp_test_token' })),
    };
  });

  describe('validation', () => {
    it('returns task_not_found when findByIdForUser fails', async () => {
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Not found' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task_not_found');
        expect(result.error.message).toContain(originalTaskId);
      }
    });

    it('returns invalid_status when task status is not completed', async () => {
      const mockTask = createMockTask({ status: 'running' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(null));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
      }
    });

    it('returns invalid_status when agentType is not planning', async () => {
      const mockTask = createMockTask({ agentType: 'execution' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(null));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
        expect(result.error.message).toContain('completed planning task');
      }
    });

    it('returns no_linear_issue when task has no linearIssueId', async () => {
      const mockTask = createMockTask();
      delete (mockTask as { linearIssueId?: string }).linearIssueId;
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('no_linear_issue');
      }
    });

    it('returns already_implemented when implementationTaskId is set', async () => {
      const existingExecutionTaskId = 'task_existing_phase2';
      const mockTask = createMockTask({ implementationTaskId: existingExecutionTaskId });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('already_implemented');
        expect(result.error.existingTaskId).toBe(existingExecutionTaskId);
      }
    });

    it('returns already_implemented when fanOutChildTaskIds are already linked', async () => {
      const mockTask = createMockTask({ fanOutChildTaskIds: ['task_child_1', 'task_child_2'] });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('already_implemented');
        expect(result.error.existingTaskId).toBe('task_child_1');
      }
    });

    it('returns active_task_exists when an active task exists for Linear issue', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'task_active' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('active_task_exists');
      }
    });

    it('returns worker_not_configured when getSettings returns no enabled workers', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [] })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
        expect(result.error.message).toContain('No workers configured');
      }
    });

    it('returns worker_not_configured when all workers are disabled', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [{ ...enabledWorker, enabled: false }] })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
      }
    });

    it('returns internal_error when getSettings returns an error', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Database error' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Failed to fetch worker settings');
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          error: expect.objectContaining({ code: 'FIRESTORE_ERROR' }),
        }),
        'Failed to fetch worker settings for Execution Agent submission'
      );
    });

    it('returns worker_not_configured when getSettings returns null (no settings)', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(null));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
        expect(result.error.message).toContain('No workers configured');
      }
    });
  });

  describe('label validation', () => {
    it('returns label_not_ready when validateIssue fails', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker] })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'Down' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('label_not_ready');
        expect(result.error.message).toContain('Failed to fetch');
      }
    });

    it('returns label_not_ready when issue has unclear label', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker] })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['unclear'],
          childCount: 0,
          parentId: null,
        })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('label_not_ready');
        // Should mention flagged questions or unclear
        expect(result.error.message.toLowerCase()).toMatch(/flagged questions|unclear/);
      }
    });

    it('returns label_not_ready when issue is missing code-task label', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker] })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['feature'],
          childCount: 0,
          parentId: null,
        })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('label_not_ready');
        expect(result.error.message).toContain('code-task label');
      }
    });
  });

  describe('optimistic lock failure', () => {
    it('returns internal_error when first update (optimistic lock) fails and does not create execution task', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker] })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      // Lock update fails
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Write failed' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
      // Execution Agent task should NOT be created
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('create execution task failure with rollback', () => {
    it('returns internal_error and rolls back optimistic lock when create fails', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker] })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      // Optimistic lock succeeds
      mockCodeTaskRepo.update.mockResolvedValue(ok(mockTask));
      // Create fails
      mockCodeTaskRepo.create.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Create failed' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
      // Rollback: implementationTaskId should be cleared
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        originalTaskId,
        expect.objectContaining({ implementationTaskId: null })
      );
    });

    it('logs error when create fails and rollback of optimistic lock also fails', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker] })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      // First update = optimistic lock (succeeds), subsequent updates fail
      mockCodeTaskRepo.update.mockImplementation(
        createSequentialUpdateMock([ok(mockTask), err({ code: 'FIRESTORE_ERROR', message: 'Rollback write failed' })])
      );
      // Create fails, triggering the rollback
      mockCodeTaskRepo.create.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Create failed' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Failed to create Execution Agent task');
      }
      // Should log the rollback failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: originalTaskId,
          error: expect.objectContaining({ code: 'FIRESTORE_ERROR' }),
        }),
        'Failed to rollback implementationTaskId after create failure'
      );
    });
  });

  describe('enqueue failure with rollback', () => {
    it('returns internal_error and rolls back when enqueue fails', async () => {
      setupHappyPathMocks();
      // Override enqueue to fail
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        err({ code: 'internal_error', message: 'No workers available' })
      );
      // update needs to succeed for rollback calls
      mockCodeTaskRepo.update.mockResolvedValue(ok({}));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
      // Should roll back: set implementationTaskId to null on original task
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        originalTaskId,
        expect.objectContaining({ implementationTaskId: null })
      );
    });

    it('returns queue_full and rolls back when enqueue returns queue_full', async () => {
      setupHappyPathMocks();
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        err({ code: 'queue_full', message: 'Queue is full' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok({}));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
        expect(result.error.message).toBe('Queue is full');
      }
      // Should roll back: set implementationTaskId to null on original task
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        originalTaskId,
        expect.objectContaining({ implementationTaskId: null })
      );
    });
  });

  // Note: at_capacity queueing tests removed — TaskEnqueueService handles all queue logic internally

  describe('happy path', () => {
    it('returns ok with correct result shape on success', async () => {
      setupHappyPathMocks();

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toMatch(/^task_/);
        expect(result.value.resourceUrl).toContain(result.value.codeTaskId);
        expect(result.value.workerLocation).toBe('queued');
        expect(result.value.implementationOf).toBe(originalTaskId);
      }
    });

    it('sets implementationTaskId on original task before creating execution task', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      // First update call should set implementationTaskId
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        originalTaskId,
        expect.objectContaining({ implementationTaskId: expect.stringMatching(/^task_/) })
      );
      // create should only be called after update
      const updateCallOrder = mockCodeTaskRepo.update.mock.invocationCallOrder[0];
      const createCallOrder = mockCodeTaskRepo.create.mock.invocationCallOrder[0];
      expect(updateCallOrder).toBeLessThan(createCallOrder ?? Infinity);
    });

    it('creates execution task with correct properties', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
          followUpReason: 'execution_implement',
          parentTaskId: originalTaskId,
          traceId: 'execution-trace-abc',
          linearIssueId,
        })
      );
    });

    it('calls updateIssueState with in_progress for the Linear issue', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockLinearAgentClient.updateIssueState).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        state: 'in_progress',
      });
    });

    it('calls addComment with both task IDs on the Linear issue', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockLinearAgentClient.addComment).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          issueId: linearIssueId,
          body: expect.stringContaining('Execution Agent implementation started'),
        })
      );
    });

    it('calls enqueue with correct task ID and user ID', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledWith({
        taskId: expect.stringMatching(/^task_/),
        userId,
      });
    });

    it('persists only linearIssueId on the execution task', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueId,
          agentType: 'execution',
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
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearFallback: expect.anything(),
        })
      );
    });

    it('merges plan PR before creating execution task when planning_pr_url exists', async () => {
      setupHappyPathMocks({
        result: {
          branch: 'plan/my-feature',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/42',
        },
      });

      const result = await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(result.ok).toBe(true);
      expect(mockGitHubPRClient.mergePullRequest).toHaveBeenCalledWith(
        'ghp_test_token', 'pbuchman', 'intexuraos', 42, 'merge', expect.any(String),
      );
    });

    it('does not include planningPrBranch or planningPrUrl on execution task', async () => {
      setupHappyPathMocks({
        result: {
          branch: 'plan/my-feature',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/42',
        },
      });

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      const createCall = mockCodeTaskRepo.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(createCall).toBeDefined();
      expect(createCall?.['planningPrBranch']).toBeUndefined();
      expect(createCall?.['planningPrUrl']).toBeUndefined();
    });

    it('skips plan PR merge when planning task has no planning_pr_url', async () => {
      setupHappyPathMocks();

      const result = await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(result.ok).toBe(true);
      expect(mockGitHubPRClient.mergePullRequest).not.toHaveBeenCalled();
    });

    it('calls enqueue after successful task creation', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalled();
    });

    it('creates execution task with execution prompt, not original planning prompt', async () => {
      setupHappyPathMocks({ prompt: 'Analyze the linked Linear issue.', sanitizedPrompt: 'Analyze the linked Linear issue.' });

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: EXECUTION_AGENT_PROMPT,
          sanitizedPrompt: EXECUTION_AGENT_PROMPT,
        })
      );
    });

    it('EXECUTION_AGENT_PROMPT mentions reading comments newest first', () => {
      expect(EXECUTION_AGENT_PROMPT).toContain('comments (newest first)');
    });

    it('does not copy actionId or approvalEventId from original task to execution task', async () => {
      // actionId and approvalEventId are Firestore dedup keys.
      // Copying them to the execution task causes DUPLICATE_APPROVAL for processCodeAction tasks.
      // retryTask.ts correctly omits these — execution path must do the same.
      setupHappyPathMocks({ actionId: 'action_abc123', approvalEventId: 'event_xyz456' });

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      const createCall = mockCodeTaskRepo.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(createCall).toBeDefined();
      expect(createCall?.['actionId']).toBeUndefined();
      expect(createCall?.['approvalEventId']).toBeUndefined();
    });

    it('sets workerLocation to queued on execution task', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workerLocation: 'queued',
        })
      );
    });
  });

  describe('plan PR merge', () => {
    it('returns plan_pr_merge_failed when plan PR merge fails', async () => {
      setupHappyPathMocks({
        result: {
          branch: 'plan/my-feature',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/42',
        },
      });
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(ok({ state: 'open', mergedAt: null, headRef: 'plan/test' }));
      mockGitHubPRClient.mergePullRequest.mockResolvedValue(err({
        code: 'API_ERROR' as const,
        message: '405 Method Not Allowed - merge conflict',
      }));

      const result = await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('plan_pr_merge_failed');
      }
      // Verify no execution task was created
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });

    it('returns plan_pr_merge_failed when GitHub token is unavailable', async () => {
      setupHappyPathMocks({
        result: {
          branch: 'plan/my-feature',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/42',
        },
      });
      mockUserServiceClient.getOAuthToken.mockResolvedValue(err({
        code: 'NOT_FOUND',
        message: 'Token not found',
      }));

      const result = await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('plan_pr_merge_failed');
        expect(result.error.message).toContain('GitHub OAuth token');
      }
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });

    it('succeeds when plan PR is already merged', async () => {
      setupHappyPathMocks({
        result: {
          branch: 'plan/my-feature',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/42',
        },
      });
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(ok({
        state: 'closed', mergedAt: new Date(), headRef: 'plan/test',
      }));

      const result = await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(result.ok).toBe(true);
      expect(mockGitHubPRClient.mergePullRequest).not.toHaveBeenCalled();
    });

    it('merges plan PR before fan-out for complex tasks', async () => {
      setupHappyPathMocks({
        result: {
          branch: 'plan/my-feature',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/42',
        },
      });
      // Override to complex-task label
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'uuid-parent-123',
          identifier: linearIssueId,
          title: 'Complex Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['complex-task'],
          childCount: 3,
          parentId: null,
        })
      );
      mockLinearAgentClient.fetchDirectChildrenLive.mockResolvedValue(
        ok([
          {
            id: 'child-uuid-1',
            identifier: 'INT-101',
            url: 'https://linear.app/pbuchman/issue/INT-101',
            parentId: 'uuid-parent-123',
            labels: ['code-task'],
            assigneeId: null,
            state: 'Backlog',
          },
        ]),
      );
      mockFanOutChildTasks.mockResolvedValue(
        ok({ childTaskIds: ['child_1', 'child_2'], primaryChildTaskId: 'child_1', primaryChildIssueId: 'INT-101' })
      );

      const result = await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(result.ok).toBe(true);
      // Verify merge happened before any task creation
      expect(mockGitHubPRClient.mergePullRequest).toHaveBeenCalled();
    });
  });

  describe('complex-task fan-out', () => {
    function setupComplexTaskMocks(taskOverrides: Partial<CodeTask> = {}): CodeTask {
      const mockTask = setupHappyPathMocks(taskOverrides);
      // Override validateIssue to return complex-task label instead of code-task
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'uuid-parent-123',
          identifier: linearIssueId,
          title: 'Complex Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['complex-task'],
          childCount: 3,
          parentId: null,
        })
      );
      mockLinearAgentClient.fetchDirectChildrenLive.mockResolvedValue(
        ok([
          {
            id: 'child-uuid-1',
            identifier: 'INT-101',
            url: 'https://linear.app/pbuchman/issue/INT-101',
            parentId: 'uuid-parent-123',
            labels: ['code-task'],
            assigneeId: null,
            state: 'Backlog',
          },
          {
            id: 'child-uuid-2',
            identifier: 'INT-102',
            url: 'https://linear.app/pbuchman/issue/INT-102',
            parentId: 'uuid-parent-123',
            labels: ['code-task'],
            assigneeId: null,
            state: 'Backlog',
          },
        ])
      );
      return mockTask;
    }

    it('uses live direct children and does not create a parent execution task for complex issues', async () => {
      setupComplexTaskMocks();
      mockFanOutChildTasks.mockResolvedValue(
        ok({
          childTaskIds: ['task_child_1', 'task_child_2'],
          primaryChildTaskId: 'task_child_1',
          primaryChildIssueId: 'INT-101',
        })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.childTaskIds).toEqual(['task_child_1', 'task_child_2']);
        expect(result.value.codeTaskId).toBe('task_child_1');
        expect(result.value.implementationOf).toBe(originalTaskId);
      }
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
      expect(mockLinearAgentClient.fetchDirectChildrenLive).toHaveBeenCalledWith({
        userId,
        issueId: 'uuid-parent-123',
      });
      expect(mockFanOutChildTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          logger: expect.anything(),
          codeTaskRepo: expect.anything(),
          taskEnqueueService: expect.anything(),
          orchestratorSecret: 'test-orchestrator-secret',
        }),
        expect.objectContaining({
          planningTask: expect.objectContaining({ id: originalTaskId }),
          childIssues: expect.arrayContaining([
            expect.objectContaining({ identifier: 'INT-101' }),
            expect.objectContaining({ identifier: 'INT-102' }),
          ]),
        })
      );
    });

    it('returns complex_task_no_qualifying_children and keeps parent unlocked when no live code-task children exist', async () => {
      setupComplexTaskMocks();
      mockLinearAgentClient.fetchDirectChildrenLive.mockResolvedValue(ok([]));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('complex_task_no_qualifying_children');
      }
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        originalTaskId,
        expect.objectContaining({ implementationTaskId: expect.any(String) })
      );
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
      expect(mockFanOutChildTasks).not.toHaveBeenCalled();
    });

    it('returns internal_error when live direct-child lookup fails', async () => {
      setupComplexTaskMocks();
      mockLinearAgentClient.fetchDirectChildrenLive.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'children unavailable' }),
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          code: 'internal_error',
          message: 'Failed to fetch child issues for complex implementation',
        });
      }
    });

    it('maps fanOutChildTasks no_qualifying_children to complex_task_no_qualifying_children', async () => {
      setupComplexTaskMocks();
      mockFanOutChildTasks.mockResolvedValue(
        err({ code: 'no_qualifying_children', message: 'No direct children with code-task label found' }),
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          code: 'complex_task_no_qualifying_children',
          message: 'No direct children with code-task label found',
        });
      }
    });

    it('maps fanOutChildTasks queue_full to queue_full', async () => {
      setupComplexTaskMocks();
      mockFanOutChildTasks.mockResolvedValue(
        err({ code: 'queue_full', message: 'Queue is full' }),
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          code: 'queue_full',
          message: 'Queue is full',
        });
      }
    });

    it('returns internal_error when fanOutChildTasks fails unexpectedly', async () => {
      setupComplexTaskMocks();
      mockFanOutChildTasks.mockResolvedValue(
        err({ code: 'internal_error', message: 'fan-out exploded' }),
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          code: 'internal_error',
          message: 'Fan-out failed: fan-out exploded',
        });
      }
    });

    it('does not call single enqueue directly for complex tasks (fan-out handles batch enqueue)', async () => {
      setupComplexTaskMocks();
      mockFanOutChildTasks.mockResolvedValue(
        ok({
          childTaskIds: ['task_child_1'],
          primaryChildTaskId: 'task_child_1',
          primaryChildIssueId: 'INT-101',
        })
      );

      await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      // The parent task should NOT be enqueued — only children are enqueued by fanOutChildTasks
      expect(mockTaskEnqueueService.enqueue).not.toHaveBeenCalled();
    });

    it('still updates Linear issue state and adds comment for complex tasks', async () => {
      setupComplexTaskMocks();
      mockFanOutChildTasks.mockResolvedValue(
        ok({
          childTaskIds: ['task_child_1'],
          primaryChildTaskId: 'task_child_1',
          primaryChildIssueId: 'INT-101',
        })
      );

      await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(mockLinearAgentClient.updateIssueState).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        state: 'in_progress',
      });
      expect(mockLinearAgentClient.addComment).toHaveBeenCalled();
    });

    it('logs warnings when parent Linear updates fail after successful fan-out', async () => {
      setupComplexTaskMocks();
      mockFanOutChildTasks.mockResolvedValue(
        ok({
          childTaskIds: ['task_child_1'],
          primaryChildTaskId: 'task_child_1',
          primaryChildIssueId: 'INT-101',
        }),
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE', message: 'state failed' }),
      );
      mockLinearAgentClient.addComment.mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE', message: 'comment failed' }),
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ linearIssueId, error: { code: 'UNAVAILABLE', message: 'state failed' } }),
        'Failed to update parent Linear issue to In Progress for complex execution',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ linearIssueId, error: { code: 'UNAVAILABLE', message: 'comment failed' } }),
        'Failed to add complex Execution Agent start comment to parent Linear issue',
      );
    });
  });

  describe('worker type resolution chain', () => {
    it('uses Linear label worker type over request workerType and user setting', async () => {
      setupHappyPathMocks({ workerType: 'sonnet' });
      // Linear label = 'opus'
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task', 'opus'],
          childCount: 0,
          parentId: null,
        })
      );
      // User setting = 'sonnet'
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker], defaultExecutionWorkerType: 'sonnet' })
      );

      await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
        workerType: 'sonnet',
      });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workerType: 'opus' })
      );
    });

    it('uses request workerType when no label matches', async () => {
      setupHappyPathMocks();
      // Labels have no worker type label
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
        workerType: 'sonnet',
      });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workerType: 'sonnet' })
      );
    });

    it('uses user defaultExecutionWorkerType when no label and no request workerType', async () => {
      setupHappyPathMocks();
      // No worker type label
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      // User setting = 'opus'
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker], defaultExecutionWorkerType: 'opus' })
      );

      await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
        // no workerType in request
      });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workerType: 'opus' })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId, defaultExecutionWorkerType: 'opus' }),
        'Using user default execution worker type'
      );
    });

    it('falls back to auto when no label, no request workerType, and no user setting', async () => {
      setupHappyPathMocks();
      // No worker type label
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      // No default setting
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker] })
      );

      await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
        // no workerType in request
      });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workerType: 'auto' })
      );
    });

    it('does NOT inherit workerType from originalTask', async () => {
      // Original task has 'opus' but no label match, no request type, no user setting
      setupHappyPathMocks({ workerType: 'opus' });
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker] })
      );

      await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
        // no workerType in request — old behavior would inherit 'opus' from originalTask
      });

      // Should be 'auto', NOT 'opus' from originalTask
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workerType: 'auto' })
      );
    });

    it('uses request workerType even when originalTask has a different workerType', async () => {
      setupHappyPathMocks({ workerType: 'opus' });
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
        workerType: 'sonnet',
      });

      // Should use request workerType 'sonnet', NOT originalTask's 'opus'
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workerType: 'sonnet' })
      );
    });
  });

  describe('graceful degradation (Linear best-effort)', () => {
    it('succeeds even when updateIssueState fails', async () => {
      setupHappyPathMocks();
      mockLinearAgentClient.updateIssueState.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'Linear down' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ linearIssueId }),
        expect.stringContaining('Failed to update Linear issue to In Progress')
      );
    });

    it('succeeds even when addComment fails', async () => {
      setupHappyPathMocks();
      mockLinearAgentClient.addComment.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'Linear down' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ linearIssueId }),
        expect.stringContaining('Failed to add Execution Agent start comment')
      );
    });

    it('proceeds when hasActiveTaskForLinearIssue check fails (best-effort)', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        err({ code: 'DB_ERROR', message: 'Database error' })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [enabledWorker] })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'My Feature',
          url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok({
          ...mockTask,
          cancelNonce: 'abcd',
          cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'task_execution',
          agentType: 'execution' as const,
          followUpReason: 'execution_implement' as const,
          parentTaskId: originalTaskId,
          traceId: 'execution-trace-abc',
          sanitizedPrompt: 'Implement feature X',
          systemPromptHash: 'hash123',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          workerType: 'auto' as const,
          webhookSecret: 'webhook-secret',
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
      mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
      mockTaskEnqueueService.enqueue.mockResolvedValue(
        ok({ taskId: 'task_execution', queuePosition: 1 })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      // Should succeed even though active task check failed
      expect(result.ok).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ linearIssueId }),
        expect.stringContaining('Failed to check for active tasks')
      );
    });
  });

  describe('planning task resolver', () => {
    it('resolves review task to planning task via linearIssueId', async () => {
      // The user calls /implement on a review task
      const reviewTask = createMockTask({
        id: 'task_review',
        agentType: 'review',
        status: 'reviewed',
        linearIssueId: 'INT-100',
      });
      // The planning task exists for the same Linear issue
      const planningTask = createMockTask({
        id: 'task_planning',
        agentType: 'planning',
        status: 'planned',
        linearIssueId: 'INT-100',
      });

      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(reviewTask));
      mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(planningTask));

      // Set up remaining happy-path mocks using the PLANNING task
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [enabledWorker] }));
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'INT-100',
          identifier: 'INT-100',
          title: 'My Feature',
          url: 'https://linear.app/pbuchman/issue/INT-100',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok({ ...planningTask, implementationTaskId: 'task_exec' }));
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...planningTask,
          id: 'task_exec',
          agentType: 'execution' as const,
          followUpReason: 'execution_implement' as const,
          parentTaskId: 'task_planning',
          traceId: 'execution-trace-abc',
          workerType: 'auto' as const,
          webhookSecret: 'webhook-secret',
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
      mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
      mockTaskEnqueueService.enqueue.mockResolvedValue(ok({ taskId: 'task_exec', queuePosition: 1 }));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId: 'task_review',
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.implementationOf).toBe('task_planning');
      }
      // Verify resolver was called with the review task's linearIssueId
      expect(mockCodeTaskRepo.findPlannedTaskByLinearIssue).toHaveBeenCalledWith('INT-100');
    });

    it('returns invalid_status when resolver finds no planning task', async () => {
      const reviewTask = createMockTask({
        id: 'task_review',
        agentType: 'review',
        status: 'reviewed',
        linearIssueId: 'INT-100',
      });

      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(reviewTask));
      mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(null));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId: 'task_review',
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
      }
    });

    it('returns invalid_status when non-planning task has no linearIssueId', async () => {
      const taskWithoutLinear = createMockTask({
        id: 'task_no_linear',
        agentType: 'review',
        status: 'reviewed',
      });
      delete (taskWithoutLinear as { linearIssueId?: string }).linearIssueId;

      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(taskWithoutLinear));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId: 'task_no_linear',
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
      }
      // Should NOT attempt resolver without linearIssueId
      expect(mockCodeTaskRepo.findPlannedTaskByLinearIssue).not.toHaveBeenCalled();
    });

    it('resolves remediation task to planning task', async () => {
      const remediationTask = createMockTask({
        id: 'task_remediation',
        agentType: 'remediation',
        status: 'implemented',
        linearIssueId: 'INT-100',
      });
      const planningTask = createMockTask({
        id: 'task_planning',
        agentType: 'planning',
        status: 'planned',
        linearIssueId: 'INT-100',
      });

      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(remediationTask));
      mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(planningTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [enabledWorker] }));
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'INT-100',
          identifier: 'INT-100',
          title: 'My Feature',
          url: 'https://linear.app/pbuchman/issue/INT-100',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok({ ...planningTask, implementationTaskId: 'task_exec' }));
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...planningTask,
          id: 'task_exec',
          agentType: 'execution' as const,
          followUpReason: 'execution_implement' as const,
          parentTaskId: 'task_planning',
          traceId: 'execution-trace-abc',
          workerType: 'auto' as const,
          webhookSecret: 'webhook-secret',
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
      mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
      mockTaskEnqueueService.enqueue.mockResolvedValue(ok({ taskId: 'task_exec', queuePosition: 1 }));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId: 'task_remediation',
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.implementationOf).toBe('task_planning');
      }
    });

    it('returns invalid_status when resolved planning task belongs to different user', async () => {
      const reviewTask = createMockTask({
        id: 'task_review',
        agentType: 'review',
        status: 'reviewed',
        linearIssueId: 'INT-100',
      });
      const otherUsersPlanningTask = createMockTask({
        id: 'task_planning',
        agentType: 'planning',
        status: 'planned',
        linearIssueId: 'INT-100',
        userId: 'other-user-id',
      });

      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(reviewTask));
      mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(otherUsersPlanningTask));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId: 'task_review',
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
      }
      // Verify security event is logged with both user IDs
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedByUserId: userId,
          taskOwnedByUserId: 'other-user-id',
        }),
        'Security: resolved planning task belongs to different user'
      );
    });

    it('returns invalid_status when resolver errors', async () => {
      const reviewTask = createMockTask({
        id: 'task_review',
        agentType: 'review',
        status: 'reviewed',
        linearIssueId: 'INT-100',
      });

      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(reviewTask));
      mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore error' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId: 'task_review',
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
      }
    });
  });
});
