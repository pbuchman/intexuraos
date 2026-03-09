/**
 * Tests for submitTaskFeedback use case (INT-465 Phase 4).
 *
 * Test Requirements from INT-465:
 * 1. Returns error when original task not found
 * 2. Returns error when task status is not 'completed'
 * 3. Returns error when active task exists for Linear issue
 * 4. Returns error when user has no workers configured
 * 5. Successfully creates follow-up task with parentTaskId set
 * 6. Updates Linear issue state to In Progress
 * 7. Adds comment to Linear issue with feedback details
 * 8. Dispatches follow-up task to worker
 * 9. Sends WhatsApp notification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type { TaskStatus } from '../../domain/models/codeTask.js';
import { Timestamp } from '@google-cloud/firestore';

// Import usecase under test
import { submitTaskFeedback, type SubmitTaskFeedbackDeps } from '../../domain/usecases/submitTaskFeedback.js';

describe('submitTaskFeedback use case', () => {
  let mockCodeTaskRepo: {
    findByIdForUser: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    hasActiveTaskForLinearIssue: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    updateIssueState: ReturnType<typeof vi.fn>;
    validateIssue: ReturnType<typeof vi.fn>;
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
  const linearIssueId = 'INT-465';
  const feedback = 'Please update the error handling to be more defensive';

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
      update: vi.fn(),
      hasActiveTaskForLinearIssue: vi.fn(),
    };

    // Mock Linear agent client
    mockLinearAgentClient = {
      updateIssueState: vi.fn(),
      validateIssue: vi.fn(),
      addComment: vi.fn(),
    };

    // Mock task dispatcher
    mockTaskDispatcher = {
      dispatch: vi.fn(),
    };

    // Mock WhatsApp notifier
    mockWhatsAppNotifier = {
      notifyTaskStarted: vi.fn(),
    };

    // Mock worker settings repo
    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };

    // Mock metrics client
    mockMetricsClient = {
      incrementTasksSubmitted: vi.fn(),
    };
  });

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
      status: 'implemented',
      dedupKey: 'dedup-123',
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

  function createDeps(): SubmitTaskFeedbackDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as SubmitTaskFeedbackDeps['codeTaskRepo'],
      linearAgentClient: mockLinearAgentClient as unknown as SubmitTaskFeedbackDeps['linearAgentClient'],
      taskDispatcher: mockTaskDispatcher as unknown as SubmitTaskFeedbackDeps['taskDispatcher'],
      whatsappNotifier: mockWhatsAppNotifier as unknown as SubmitTaskFeedbackDeps['whatsappNotifier'],
      metricsClient: mockMetricsClient as unknown as SubmitTaskFeedbackDeps['metricsClient'],
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as SubmitTaskFeedbackDeps['workerSettingsRepo'],
      orchestratorSecret: 'test-orchestrator-secret',
      serviceUrl: 'https://test.example.com',
    };
  }

  describe('validation', () => {
    it('should return error when original task not found', async () => {
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Task not found' })
      );

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task_not_found');
        expect(result.error.message).toContain('not found');
      }
    });

    it('should return error when task status is not completed', async () => {
      const nonCompletedStatuses: TaskStatus[] = ['dispatched', 'running', 'failed', 'interrupted', 'cancelled'];

      for (const status of nonCompletedStatuses) {
        vi.clearAllMocks();
        const mockTask = createMockTask({ status });
        mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

        const deps = createDeps();
        const result = await submitTaskFeedback(deps, {
          originalTaskId,
          userId,
          feedback,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('invalid_status');
          expect(result.error.message).toContain('Only completed tasks can receive feedback');
        }
      }
    });

    it('should return error when active task exists for Linear issue', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'active-task-123' })
      );

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
        expect(result.error.message).toContain('active task already exists');
      }
    });

    it('should return error when user has no workers configured', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({ workers: [] })
      );

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
        expect(result.error.message).toContain('configure your workers');
      }
    });

    it('should return error when all workers are disabled', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'https://worker.local',
              enabled: false,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'signing-secret',
            },
          ],
        })
      );

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
        expect(result.error.message).toContain('configure your workers');
      }
    });
  });

  describe('successful feedback submission', () => {
    beforeEach(() => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'https://worker.local',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'signing-secret',
            },
          ],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
        })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Feedback mechanism test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['feature', 'backend'],
          childCount: 0,
          parentId: null,
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
      mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          cancelNonce: 'abc123',
          cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
      );
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));
    });

    it('should create follow-up task with parentTaskId and followUpReason', async () => {
      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentTaskId: originalTaskId,
          followUpReason: 'user_feedback',
          prompt: expect.stringContaining(feedback),
        })
      );
    });

    it('should set agentType to design when validateIssue returns no code-task label', async () => {
      // Default beforeEach mock returns labels: ['feature', 'backend'] — no code-task label.
      // agentType should be 'design'.
      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(true);

      // agentType is 'design' because validateIssue returns labels without 'code-task'
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'planning',
        })
      );
    });

    it('should set agentType to execution when validateIssue returns code-task label', async () => {
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Feedback mechanism test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(true);

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
        })
      );
    });

    it('stores agentType in Firestore at create() call time when code-task label is present', async () => {
      // toHaveBeenCalledWith evaluates object references at assertion time, not at call time.
      // This test uses mockImplementation to capture the value synchronously at create() time,
      // proving the value is correct before the Firestore write (not just after).
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Feedback mechanism test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      const mockTask = createMockTask();
      let agentTypeAtCreateTime: unknown;
      mockCodeTaskRepo.create.mockImplementation(async (input: Record<string, unknown>) => {
        agentTypeAtCreateTime = input['agentType'];
        return ok({ ...mockTask, id: 'feedback-task-123', parentTaskId: originalTaskId });
      });

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, { originalTaskId, userId, feedback });

      expect(result.ok).toBe(true);
      // agentType must be 'execution' at Firestore write time, not just after post-create mutation
      expect(agentTypeAtCreateTime).toBe('execution');
    });

    it('should preserve pull_request agentType from original task instead of using label-based routing', async () => {
      const mockTask = createMockTask({ agentType: 'pull_request' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      // Even if labels say 'code-task' (execution), pull_request must be preserved
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Feedback mechanism test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      let createInputAgentType: unknown;
      mockCodeTaskRepo.create.mockImplementation(async (input: Record<string, unknown>) => {
        createInputAgentType = input['agentType'];
        return ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
          agentType: input['agentType'],
        });
      });

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, { originalTaskId, userId, feedback });

      expect(result.ok).toBe(true);
      // createInput must use pull_request, not execution (even though code-task label exists)
      expect(createInputAgentType).toBe('pull_request');
      // dispatchRequest must also carry pull_request
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: 'pull_request' })
      );
    });

    it('should preserve review agentType from original task instead of using label-based routing', async () => {
      const mockTask = createMockTask({ agentType: 'review' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Review feedback test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      let createInputAgentType: unknown;
      mockCodeTaskRepo.create.mockImplementation(async (input: Record<string, unknown>) => {
        createInputAgentType = input['agentType'];
        return ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
          agentType: input['agentType'],
        });
      });

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, { originalTaskId, userId, feedback });

      expect(result.ok).toBe(true);
      expect(createInputAgentType).toBe('review');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: 'review' })
      );
    });

    it('should fall back to label-based routing when original task is not pull_request', async () => {
      // agentType is undefined (legacy task) — should use labels to decide
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      // Labels contain code-task → should pick execution
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Feedback mechanism test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      let createInputAgentType: unknown;
      mockCodeTaskRepo.create.mockImplementation(async (input: Record<string, unknown>) => {
        createInputAgentType = input['agentType'];
        return ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
          agentType: input['agentType'],
        });
      });

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, { originalTaskId, userId, feedback });

      expect(result.ok).toBe(true);
      // createInput must use label-based routing (execution) when no pull_request
      expect(createInputAgentType).toBe('execution');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: 'execution' })
      );
    });

    it('should include feedback in follow-up prompt', async () => {
      const deps = createDeps();
      await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      const createCall = mockCodeTaskRepo.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      expect(createCall?.prompt).toContain('## User Feedback (follow-up)');
      expect(createCall?.prompt).toContain(feedback);
    });

    it('should update Linear issue to In Progress', async () => {
      const deps = createDeps();
      await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(mockLinearAgentClient.updateIssueState).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        state: 'in_progress',
      });
    });

    it('should add comment to Linear issue with feedback details', async () => {
      const deps = createDeps();
      await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(mockLinearAgentClient.addComment).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        body: expect.stringContaining('Follow-up task created'),
      });
      expect(mockLinearAgentClient.addComment).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        body: expect.stringContaining(feedback),
      });
    });

    it('should dispatch follow-up task to worker', async () => {
      const deps = createDeps();
      await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'feedback-task-123',
          parentTaskId: originalTaskId,
          linearIssueLabels: ['feature', 'backend'],
          hasChildren: false,
        })
      );
    });

    it('should send WhatsApp notification', async () => {
      const deps = createDeps();
      await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(mockWhatsAppNotifier.notifyTaskStarted).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          id: 'feedback-task-123',
          cancelNonce: expect.any(String),
        })
      );
    });

    it('should return follow-up task details', async () => {
      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          codeTaskId: 'feedback-task-123',
          resourceUrl: '/#/code-tasks/feedback-task-123',
          workerLocation: 'home-mac',
          followUpFor: originalTaskId,
        });
      }
    });

    it('persists only linearIssueId on the follow-up task', async () => {
      const deps = createDeps();

      await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

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
          linearFallback: expect.anything(),
        })
      );
    });

    it('should dispatch with empty labels when task has no Linear issue', async () => {
      const mockTask = createMockTask();
      delete (mockTask as { linearIssueId?: string }).linearIssueId;
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
        })
      );

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(true);
      expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueLabels: [],
          hasChildren: false,
        })
      );
    });
  });

  describe('graceful degradation', () => {
    it('should dispatch with empty labels when validateIssue fails', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'https://worker.local',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'signing-secret',
            },
          ],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
        })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        err({ code: 'LINEAR_ERROR', message: 'Failed to validate' })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
      mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          cancelNonce: 'abc123',
          cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
      );
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ linearIssueId }),
        expect.stringContaining('Failed to fetch Linear issue labels')
      );
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueLabels: [],
          hasChildren: false,
        })
      );
    });
    it('should continue if Linear issue update fails', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'https://worker.local',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'signing-secret',
            },
          ],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
        })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Feedback mechanism test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['feature', 'backend'],
          childCount: 0,
          parentId: null,
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(
        err({ code: 'LINEAR_ERROR', message: 'Failed to update' })
      );
      mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          cancelNonce: 'abc123',
          cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
      );
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      // Should still succeed even if Linear update fails
      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueId,
        }),
        expect.stringContaining('Failed to update Linear issue')
      );
    });

    it('should continue if Linear comment fails', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'https://worker.local',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'signing-secret',
            },
          ],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
        })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Feedback mechanism test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['feature', 'backend'],
          childCount: 0,
          parentId: null,
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
      mockLinearAgentClient.addComment.mockResolvedValue(
        err({ code: 'LINEAR_ERROR', message: 'Failed to comment' })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          cancelNonce: 'abc123',
          cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
      );
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      // Should still succeed even if comment fails
      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueId,
        }),
        expect.stringContaining('Failed to add comment')
      );
    });

    it('should continue if active task check fails', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        err({ code: 'DB_ERROR', message: 'Database error' })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'https://worker.local',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'signing-secret',
            },
          ],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
        })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Feedback mechanism test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['feature', 'backend'],
          childCount: 0,
          parentId: null,
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
      mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          cancelNonce: 'abc123',
          cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
      );
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      // Should still succeed even if active check fails
      expect(result.ok).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueId,
        }),
        expect.stringContaining('Failed to check for active tasks')
      );
    });

    it('should mark follow-up task as failed when dispatch fails', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: false })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home-mac',
              url: 'https://worker.local',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'signing-secret',
            },
          ],
        })
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
          parentTaskId: originalTaskId,
        })
      );
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: linearIssueId,
          identifier: linearIssueId,
          title: 'Feedback mechanism test',
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['feature', 'backend'],
          childCount: 0,
          parentId: null,
        })
      );
      mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
      mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'worker_unavailable', message: 'No workers available' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        ok({
          ...mockTask,
          id: 'feedback-task-123',
        })
      );

      const deps = createDeps();
      const result = await submitTaskFeedback(deps, {
        originalTaskId,
        userId,
        feedback,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }

      // Verify task was updated with failed status and dispatch error
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'feedback-task-123',
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({ code: 'worker_unavailable' }),
        })
      );
    });
  });
});
