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

describe('submitToExecutionAgent', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findByIdForUser: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    hasActiveTaskForLinearIssue: ReturnType<typeof vi.fn>;
    countQueued: ReturnType<typeof vi.fn>;
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
    notifyTaskQueued: ReturnType<typeof vi.fn>;
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
      taskDispatcher: mockTaskDispatcher as unknown as SubmitToExecutionAgentDeps['taskDispatcher'],
      whatsappNotifier: mockWhatsAppNotifier as unknown as SubmitToExecutionAgentDeps['whatsappNotifier'],
      metricsClient: mockMetricsClient as unknown as SubmitToExecutionAgentDeps['metricsClient'],
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as SubmitToExecutionAgentDeps['workerSettingsRepo'],
      orchestratorSecret: 'test-orchestrator-secret',
      serviceUrl: 'https://test.example.com',
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
      countQueued: vi.fn(),
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
      notifyTaskQueued: vi.fn().mockResolvedValue(ok(undefined)),
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      // First update = optimistic lock (succeeds), second update = rollback (fails)
      let updateCallCount = 0;
      mockCodeTaskRepo.update.mockImplementation(() => {
        updateCallCount++;
        if (updateCallCount <= 1) {
          return Promise.resolve(ok(mockTask));
        }
        // Rollback fails
        return Promise.resolve(err({ code: 'FIRESTORE_ERROR', message: 'Rollback write failed' }));
      });
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

  describe('dispatch failure with rollback', () => {
    it('returns internal_error and rolls back when dispatch fails', async () => {
      setupHappyPathMocks();
      // Override dispatch to fail
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'worker_unavailable', message: 'No workers available' })
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
      // Should mark execution task as failed
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        expect.stringContaining('task_'),
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({ code: 'worker_unavailable' }),
        })
      );
    });
  });

  describe('queueing on at_capacity', () => {
    it('queues execution task when dispatch returns at_capacity and queue is not full', async () => {
      setupHappyPathMocks();
      // Override dispatch to return at_capacity
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'All workers at capacity' })
      );
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(2));
      // update needs to succeed for optimistic lock
      mockCodeTaskRepo.update.mockResolvedValue(ok({ id: 'task_queued', status: 'queued' }));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('queued');
        expect(result.value.implementationOf).toBe(originalTaskId);
      }

      // Should NOT rollback implementationTaskId (task is valid, just waiting)
      const rollbackCalls = mockCodeTaskRepo.update.mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>)['implementationTaskId'] === null
      );
      expect(rollbackCalls).toHaveLength(0);

      // Should send queued notification
      expect(mockWhatsAppNotifier.notifyTaskQueued).toHaveBeenCalledWith(
        userId,
        expect.anything(),
        2, // position = queuedCount(2)
        10 // estimatedWaitMinutes = position(2) * 5
      );
    });

    it('returns error when dispatch returns at_capacity and queue is full', async () => {
      setupHappyPathMocks();
      // Override dispatch to return at_capacity
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'All workers at capacity' })
      );
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(11)); // maxSize default is 10, condition is > not >=
      // update needs to succeed for rollback + fail mark
      mockCodeTaskRepo.update.mockResolvedValue(ok({}));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
        expect(result.error.message).toContain('queue is full');
      }

      // Should rollback implementationTaskId
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        originalTaskId,
        expect.objectContaining({ implementationTaskId: null })
      );

      // Should mark execution task as failed
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        expect.stringContaining('task_'),
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({ code: 'queue_full' }),
        })
      );

      // Should NOT send queued notification
      expect(mockWhatsAppNotifier.notifyTaskQueued).not.toHaveBeenCalled();
    });

    it('treats as queue full when countQueued fails (falls back to maxSize)', async () => {
      setupHappyPathMocks();
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'All workers at capacity' })
      );
      // countQueued fails — should fall back to config.queue.maxSize, triggering queue full
      mockCodeTaskRepo.countQueued.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'DB error' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok({}));

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
      }

      // Should log the countQueued failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'FIRESTORE_ERROR' }) }),
        'Failed to count queued tasks, treating as queue full'
      );
    });

    it('logs warning when queued notification fails', async () => {
      setupHappyPathMocks();
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'All workers at capacity' })
      );
      mockCodeTaskRepo.countQueued.mockResolvedValue(ok(2));
      mockCodeTaskRepo.update.mockResolvedValue(ok({ id: originalTaskId }));

      // Notification fails
      mockWhatsAppNotifier.notifyTaskQueued.mockResolvedValue(
        err({ code: 'notification_failed', message: 'WhatsApp unavailable' })
      );

      const result = await submitToExecutionAgent(createDeps(), {
        originalTaskId,
        userId,
      });

      // Should still succeed (best-effort notification)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('queued');
      }

      // Should log queue update failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'FIRESTORE_ERROR' }),
        }),
        'Failed to update execution task to queued status'
      );

      // Should log notification failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'notification_failed' }) }),
        'Failed to send task queued notification'
      );
    });
  });

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
        expect(result.value.workerLocation).toBe('home-dev');
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

    it('calls dispatch with correct parameters including fresh labels', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueId,
          linearIssueLabels: ['code-task'],
          hasChildren: false,
        })
      );
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

    it('passes planning PR info to dispatch when original task has result with branch and planning_pr_url', async () => {
      setupHappyPathMocks({
        result: {
          branch: 'plan/my-feature',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/42',
        },
      });

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          planningPrBranch: 'plan/my-feature',
          planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
        })
      );
    });

    it('omits planning PR fields from dispatch when original task has no result', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      const dispatchCall = mockTaskDispatcher.dispatch.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(dispatchCall).toBeDefined();
      expect(dispatchCall?.['planningPrBranch']).toBeUndefined();
      expect(dispatchCall?.['planningPrUrl']).toBeUndefined();
    });

    it('sends WhatsApp notification after successful dispatch', async () => {
      setupHappyPathMocks();

      await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(mockWhatsAppNotifier.notifyTaskStarted).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ cancelNonce: expect.any(String) })
      );
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
          url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
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
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-dev' })
      );
      mockWhatsAppNotifier.notifyTaskStarted.mockResolvedValue(ok(undefined));

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
});
