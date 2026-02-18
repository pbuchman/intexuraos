/**
 * Tests for submitToPhase2 use case.
 *
 * Validates the full workflow of starting Phase 2 implementation
 * from a completed Phase 1 design task, including:
 * - Input validation (task status, phase, Linear issue, duplicate guard)
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
  submitToPhase2,
  type SubmitToPhase2Deps,
} from '../../../domain/usecases/submitToPhase2.js';

describe('submitToPhase2', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findByIdForUser: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    hasActiveTaskForLinearIssue: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    validateIssue: ReturnType<typeof vi.fn>;
    updateIssueState: ReturnType<typeof vi.fn>;
    addComment: ReturnType<typeof vi.fn>;
  };
  let mockTaskDispatcher: {
    dispatch: ReturnType<typeof vi.fn>;
  };
  let mockWhatsAppNotifier: {
    notifyTaskStarted: ReturnType<typeof vi.fn>;
  };
  let mockMetricsClient: {
    incrementTasksSubmitted: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
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
      status: 'completed',
      executionPhase: 'design',
      dedupKey: 'dedup-abc',
      callbackReceived: true,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      linearIssueId,
      linearIssueTitle: 'My Feature',
    };

    // Apply overrides, but skip undefined values to avoid exactOptionalPropertyTypes issues
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        (task as unknown as Record<string, unknown>)[key] = value;
      }
    }

    return task;
  }

  function createDeps(): SubmitToPhase2Deps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as SubmitToPhase2Deps['codeTaskRepo'],
      linearAgentClient: mockLinearAgentClient as unknown as SubmitToPhase2Deps['linearAgentClient'],
      taskDispatcher: mockTaskDispatcher as unknown as SubmitToPhase2Deps['taskDispatcher'],
      whatsappNotifier: mockWhatsAppNotifier as unknown as SubmitToPhase2Deps['whatsappNotifier'],
      metricsClient: mockMetricsClient as unknown as SubmitToPhase2Deps['metricsClient'],
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as SubmitToPhase2Deps['workerSettingsRepo'],
      orchestratorSecret: 'test-orchestrator-secret',
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
        url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
        labels: ['code-task'],
        childCount: 0,
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
        id: 'task_phase2',
        executionPhase: 'execution' as const,
        followUpReason: 'phase2_implement' as const,
        parentTaskId: originalTaskId,
        traceId: 'phase2-trace-abc',
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
    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-dev' })
    );
    mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

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
    };

    mockLinearAgentClient = {
      validateIssue: vi.fn(),
      updateIssueState: vi.fn(),
      addComment: vi.fn(),
    };

    mockTaskDispatcher = {
      dispatch: vi.fn(),
    };

    mockWhatsAppNotifier = {
      notifyTaskStarted: vi.fn(),
    };

    mockMetricsClient = {
      incrementTasksSubmitted: vi.fn(),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };
  });

  describe('validation', () => {
    it('returns task_not_found when findByIdForUser fails', async () => {
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Not found' })
      );

      const result = await submitToPhase2(createDeps(), {
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

      const result = await submitToPhase2(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
      }
    });

    it('returns invalid_status when executionPhase is not design', async () => {
      const mockTask = createMockTask({ executionPhase: 'execution' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const result = await submitToPhase2(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
        expect(result.error.message).toContain('completed design task');
      }
    });

    it('returns no_linear_issue when task has no linearIssueId', async () => {
      const mockTask = createMockTask();
      delete (mockTask as { linearIssueId?: string }).linearIssueId;
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const result = await submitToPhase2(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('no_linear_issue');
      }
    });

    it('returns already_implemented when implementationTaskId is set', async () => {
      const existingPhase2Id = 'task_existing_phase2';
      const mockTask = createMockTask({ implementationTaskId: existingPhase2Id });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));

      const result = await submitToPhase2(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('already_implemented');
        expect(result.error.existingTaskId).toBe(existingPhase2Id);
      }
    });

    it('returns active_task_exists when an active task exists for Linear issue', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'task_active' })
      );

      const result = await submitToPhase2(createDeps(), {
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

      const result = await submitToPhase2(createDeps(), {
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

      const result = await submitToPhase2(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
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

      const result = await submitToPhase2(createDeps(), {
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['unclear'],
          childCount: 0,
        })
      );

      const result = await submitToPhase2(createDeps(), {
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['feature'],
          childCount: 0,
        })
      );

      const result = await submitToPhase2(createDeps(), {
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
    it('returns internal_error when first update (optimistic lock) fails and does not create phase 2 task', async () => {
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
        })
      );
      // Lock update fails
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Write failed' })
      );

      const result = await submitToPhase2(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
      // Phase 2 task should NOT be created
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('create phase2 task failure with rollback', () => {
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
        })
      );
      // Optimistic lock succeeds
      mockCodeTaskRepo.update.mockResolvedValue(ok(mockTask));
      // Create fails
      mockCodeTaskRepo.create.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Create failed' })
      );

      const result = await submitToPhase2(createDeps(), {
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
  });

  describe('dispatch failure with rollback', () => {
    it('returns internal_error and rolls back when dispatch fails', async () => {
      setupHappyPathMocks();
      // Override dispatch to fail
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'worker_unavailable', message: 'No workers available' })
      );
      // update needs to succeed for rollback calls
      mockCodeTaskRepo.update.mockResolvedValue(ok({}));

      const result = await submitToPhase2(createDeps(), {
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
      // Should mark phase 2 task as failed
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        expect.stringContaining('task_'),
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({ code: 'worker_unavailable' }),
        })
      );
    });
  });

  describe('happy path', () => {
    it('returns ok with correct result shape on success', async () => {
      setupHappyPathMocks();

      const result = await submitToPhase2(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toMatch(/^task_/);
        expect(result.value.resourceUrl).toContain(result.value.codeTaskId);
        expect(result.value.workerLocation).toBe('home-dev');
        expect(result.value.implementationOf).toBe(originalTaskId);
      }
    });

    it('sets implementationTaskId on original task before creating phase2 task', async () => {
      setupHappyPathMocks();

      await submitToPhase2(createDeps(), { originalTaskId, userId });

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

    it('creates phase2 task with correct properties', async () => {
      setupHappyPathMocks();

      await submitToPhase2(createDeps(), { originalTaskId, userId });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          executionPhase: 'execution',
          followUpReason: 'phase2_implement',
          parentTaskId: originalTaskId,
          traceId: 'phase2-trace-abc',
          linearIssueId,
        })
      );
    });

    it('calls updateIssueState with in_progress for the Linear issue', async () => {
      setupHappyPathMocks();

      await submitToPhase2(createDeps(), { originalTaskId, userId });

      expect(mockLinearAgentClient.updateIssueState).toHaveBeenCalledWith({
        userId,
        issueId: linearIssueId,
        state: 'in_progress',
      });
    });

    it('calls addComment with both task IDs on the Linear issue', async () => {
      setupHappyPathMocks();

      await submitToPhase2(createDeps(), { originalTaskId, userId });

      expect(mockLinearAgentClient.addComment).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          issueId: linearIssueId,
          body: expect.stringContaining('Phase 2 implementation started'),
        })
      );
    });

    it('calls dispatch with correct parameters including fresh labels', async () => {
      setupHappyPathMocks();

      await submitToPhase2(createDeps(), { originalTaskId, userId });

      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueId,
          linearIssueLabels: ['code-task'],
          hasChildren: false,
        })
      );
    });

    it('sends WhatsApp notification after successful dispatch', async () => {
      setupHappyPathMocks();

      await submitToPhase2(createDeps(), { originalTaskId, userId });

      expect(mockWhatsAppNotifier.notifyTaskStarted).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ cancelNonce: expect.any(String) })
      );
    });

    it('creates phase2 task with sanitizedPrompt from original task, not raw prompt field', async () => {
      setupHappyPathMocks({ prompt: 'raw prompt with PII', sanitizedPrompt: 'clean sanitized prompt' });

      await submitToPhase2(createDeps(), { originalTaskId, userId });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sanitizedPrompt: 'clean sanitized prompt' })
      );
    });

    it('does not copy actionId or approvalEventId from original task to phase2 task', async () => {
      // actionId and approvalEventId are Firestore dedup keys.
      // Copying them to the phase2 task causes DUPLICATE_APPROVAL for processCodeAction tasks.
      // retryTask.ts correctly omits these — phase2 must do the same.
      setupHappyPathMocks({ actionId: 'action_abc123', approvalEventId: 'event_xyz456' });

      await submitToPhase2(createDeps(), { originalTaskId, userId });

      const createCall = mockCodeTaskRepo.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(createCall).toBeDefined();
      expect(createCall?.['actionId']).toBeUndefined();
      expect(createCall?.['approvalEventId']).toBeUndefined();
    });
  });

  describe('graceful degradation (Linear best-effort)', () => {
    it('succeeds even when updateIssueState fails', async () => {
      setupHappyPathMocks();
      mockLinearAgentClient.updateIssueState.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'Linear down' })
      );

      const result = await submitToPhase2(createDeps(), {
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

      const result = await submitToPhase2(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ linearIssueId }),
        expect.stringContaining('Failed to add Phase 2 start comment')
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
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
          id: 'task_phase2',
          executionPhase: 'execution' as const,
          followUpReason: 'phase2_implement' as const,
          parentTaskId: originalTaskId,
          traceId: 'phase2-trace-abc',
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
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-dev' })
      );
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

      const result = await submitToPhase2(createDeps(), {
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
});
