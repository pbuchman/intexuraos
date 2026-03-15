/**
 * Tests for drainRetryQueue use case.
 *
 * Dispatch Retry Queue: Retry failed webhook dispatches.
 *
 * Test Requirements:
 * 1. Empty queue → returns { action: 'empty' }
 * 2. TTL expired → deletes entry, notifies user, returns { action: 'expired' }
 * 3. Max attempts exceeded → deletes entry, notifies user, returns { action: 'exhausted' }
 * 4. new_task: successful dispatch → deletes retry entry, updates task to dispatched
 * 5. new_task: retryable failure → increments attempts
 * 6. new_task: non-retryable failure → deletes entry, marks task failed
 * 7. task_message: successful send → deletes retry entry, writes resumed log
 * 8. task_message: retryable failure → increments attempts
 * 9. Concurrent drain → second call returns { action: 'skipped' }
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import {
  drainRetryQueue,
  _resetRetryDrainGuard,
  type DrainRetryQueueDeps,
} from '../../../domain/usecases/drainRetryQueue.js';

// Mock config
vi.mock('../../../config.js', () => ({
  loadConfig: (): { retryQueue: { maxAttempts: number; ttlMinutes: number }; serviceUrl: string } => ({
    retryQueue: { maxAttempts: 3, ttlMinutes: 10 },
    serviceUrl: 'https://code-agent.test',
  }),
}));

// Mock secrets
vi.mock('../../../domain/utils/secrets.js', () => ({
  generateCancelNonce: (): string => 'abcd1234',
  CANCEL_NONCE_TTL_MS: 15 * 60 * 1000,
}));

describe('drainRetryQueue', () => {
  let mockLogger: Logger;
  let mockDispatchRetryRepo: {
    findOldest: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let mockCodeTaskRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockTaskDispatcher: {
    dispatch: ReturnType<typeof vi.fn>;
    sendMessageToWorker: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    validateIssue: ReturnType<typeof vi.fn>;
  };
  let mockWhatsappNotifier: {
    notifyDispatchRetryExhausted: ReturnType<typeof vi.fn>;
    notifyTaskStarted: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockLogLineRepo: {
    storeBatch: ReturnType<typeof vi.fn>;
  };
  let mockStatusMirrorService: {
    mirrorStatus: ReturnType<typeof vi.fn>;
  };

  const workerConfig = {
    name: 'home-mac',
    url: 'https://worker.local',
    cfAccessClientId: 'client-id',
    cfAccessClientSecret: 'client-secret',
    dispatchSigningSecret: 'signing-secret',
    enabled: true,
  };

  const sampleNewTaskRetry = {
    id: 'dr_abc',
    type: 'new_task' as const,
    eventId: 'evt_123',
    repository: 'intexuraos/test-repo',
    pullRequestNumber: 42,
    senderLogin: 'testuser',
    taskId: 'task_xyz',
    comment: 'fix the bug',
    attempts: 0,
    maxAttempts: 3,
    lastError: 'worker_unavailable',
    createdAt: Timestamp.fromDate(new Date()),
    ttlMinutes: 10,
  };

  const sampleTaskMessageRetry = {
    id: 'dr_def',
    type: 'task_message' as const,
    eventId: 'evt_456',
    repository: 'intexuraos/test-repo',
    pullRequestNumber: 10,
    senderLogin: 'testuser',
    taskId: 'task_xyz',
    userId: 'user_123',
    message: 'please also fix tests',
    attempts: 0,
    maxAttempts: 3,
    lastError: 'worker_unavailable',
    createdAt: Timestamp.fromDate(new Date()),
    ttlMinutes: 10,
  };

  const sampleTask = {
    id: 'task_xyz',
    userId: 'user_123',
    status: 'queued',
    repository: 'intexuraos/test-repo',
    baseBranch: 'main',
    workerType: 'opus',
    sanitizedPrompt: 'fix the bug',
    prompt: 'fix the bug',
    systemPromptHash: 'abc123',
    traceId: 'trace_123',
    webhookSecret: 'secret_123',
    createdAt: Timestamp.fromDate(new Date()),
  };

  function buildDeps(): DrainRetryQueueDeps {
    return {
      logger: mockLogger,
      dispatchRetryRepo: mockDispatchRetryRepo as unknown as DrainRetryQueueDeps['dispatchRetryRepo'],
      codeTaskRepo: mockCodeTaskRepo as unknown as DrainRetryQueueDeps['codeTaskRepo'],
      taskDispatcher: mockTaskDispatcher as unknown as DrainRetryQueueDeps['taskDispatcher'],
      linearAgentClient: mockLinearAgentClient as unknown as DrainRetryQueueDeps['linearAgentClient'],
      whatsappNotifier: mockWhatsappNotifier as unknown as DrainRetryQueueDeps['whatsappNotifier'],
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as DrainRetryQueueDeps['workerSettingsRepo'],
      logLineRepo: mockLogLineRepo as unknown as DrainRetryQueueDeps['logLineRepo'],
      statusMirrorService: mockStatusMirrorService as unknown as DrainRetryQueueDeps['statusMirrorService'],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRetryDrainGuard();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    mockDispatchRetryRepo = {
      findOldest: vi.fn(),
      delete: vi.fn().mockResolvedValue(ok(undefined)),
      update: vi.fn().mockResolvedValue(ok(undefined)),
      create: vi.fn(),
    };

    mockCodeTaskRepo = {
      findById: vi.fn().mockResolvedValue(ok(sampleTask)),
      update: vi.fn().mockResolvedValue(ok(sampleTask)),
    };

    mockTaskDispatcher = {
      dispatch: vi.fn(),
      sendMessageToWorker: vi.fn(),
    };

    mockLinearAgentClient = {
      validateIssue: vi.fn().mockResolvedValue(ok({ labels: [], childCount: 0 })),
    };

    mockWhatsappNotifier = {
      notifyDispatchRetryExhausted: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskStarted: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn().mockResolvedValue(ok({ workers: [workerConfig] })),
    };

    mockLogLineRepo = {
      storeBatch: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockStatusMirrorService = {
      mirrorStatus: vi.fn().mockResolvedValue(ok(undefined)),
    };
  });

  afterEach(() => {
    _resetRetryDrainGuard();
  });

  it('returns empty when no retry entries exist', async () => {
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(null));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe('empty');
  });

  it('returns skipped on concurrent drain', async () => {
    // Simulate long-running drain
    mockDispatchRetryRepo.findOldest.mockImplementation(() =>
      new Promise((resolve) => setTimeout(() => resolve(ok(null)), 100))
    );

    const promise1 = drainRetryQueue(buildDeps());
    const result2 = await drainRetryQueue(buildDeps());

    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.value.action).toBe('skipped');

    await promise1;
  });

  it('expires entry when TTL exceeded', async () => {
    const expiredRetry = {
      ...sampleNewTaskRetry,
      createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)), // 20 mins ago
    };
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredRetry));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe('expired');
    expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
    expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).toHaveBeenCalled();
  });

  it('exhausts entry when max attempts exceeded', async () => {
    const exhaustedRetry = {
      ...sampleNewTaskRetry,
      attempts: 3,
      maxAttempts: 3,
    };
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedRetry));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe('exhausted');
    expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
    expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).toHaveBeenCalled();
  });

  describe('new_task retry', () => {
    it('dispatches successfully and deletes retry entry', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({ status: 'dispatched' }));
    });

    it('forwards continuation PR metadata and archives the original task after retry dispatch', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(
        ok({
          ...sampleTask,
          prNumber: 1144,
          prBranch: 'task_existing_pr_branch',
          retriedFrom: 'task_original_retry_source',
          agentType: 'execution',
        })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update
        .mockResolvedValueOnce(ok({ ...sampleTask, status: 'dispatched', workerLocation: 'home-mac' }))
        .mockResolvedValueOnce(ok({ ...sampleTask, id: 'task_original_retry_source', status: 'archived' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          continuationPrNumber: 1144,
          continuationPrBranch: 'task_existing_pr_branch',
          agentType: 'execution',
        })
      );
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_original_retry_source', {
        status: 'archived',
      });
    });

    it('logs a warning when archiving the original task after retry dispatch fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(
        ok({
          ...sampleTask,
          prNumber: 1144,
          prBranch: 'task_existing_pr_branch',
          retriedFrom: 'task_original_retry_source',
          agentType: 'execution',
        })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update
        .mockResolvedValueOnce(ok({ ...sampleTask, status: 'dispatched', workerLocation: 'home-mac' }))
        .mockResolvedValueOnce(
          err({ code: 'FIRESTORE_ERROR', message: 'archive failed' })
        );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.action).toBe('dispatched');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          originalTaskId: 'task_original_retry_source',
          retryTaskId: 'task_xyz',
        }),
        'Failed to archive original task after retry drain dispatch'
      );
      expect(mockWhatsappNotifier.notifyTaskStarted).toHaveBeenCalled();
    });

    it('increments attempts on retryable failure', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({ code: 'worker_unavailable', message: 'connection refused' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_abc', expect.objectContaining({ attempts: 1 }));
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes entry and fails task on non-retryable error', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({ code: 'dispatch_failed', message: 'bad payload' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({ status: 'failed' }));
    });

    it('returns failed when new_task entry has no taskId', async () => {
      const entryWithoutTaskId = {
        ...sampleNewTaskRetry,
        taskId: undefined,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(entryWithoutTaskId));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
    });

    it('returns failed when task lookup fails for retry', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(err({ code: 'not_found', message: 'task not found' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
    });

    it('returns retry_failed when worker settings fetch fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(err({ code: 'not_found', message: 'no settings' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_abc', expect.objectContaining({
        attempts: 1,
        lastError: 'Failed to fetch worker settings',
      }));
    });

    it('returns retry_failed when worker settings value is null', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(null));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_abc', expect.objectContaining({
        lastError: 'Failed to fetch worker settings',
      }));
    });

    it('returns retry_failed when no enabled workers exist', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [{ ...workerConfig, enabled: false }] }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_abc', expect.objectContaining({
        lastError: 'No enabled workers',
      }));
    });

    it('fetches Linear metadata when task has linearIssueId', async () => {
      const taskWithLinear = { ...sampleTask, linearIssueId: 'INT-123' };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(taskWithLinear));
      mockLinearAgentClient.validateIssue.mockResolvedValue(ok({ labels: ['bug'], childCount: 2 }));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockLinearAgentClient.validateIssue).toHaveBeenCalledWith({
        userId: 'user_123',
        identifier: 'INT-123',
      });
    });

    it('continues dispatch when Linear metadata fetch fails', async () => {
      const taskWithLinear = { ...sampleTask, linearIssueId: 'INT-123' };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(taskWithLinear));
      mockLinearAgentClient.validateIssue.mockResolvedValue(err({ code: 'not_found', message: 'issue not found' }));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockLinearAgentClient.validateIssue).toHaveBeenCalled();
    });

    it('increments attempts on at_capacity dispatch error', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({ code: 'at_capacity', message: 'all workers busy' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_abc', expect.objectContaining({
        attempts: 1,
        lastError: 'all workers busy',
      }));
    });

    it('notifies user on successful dispatch when task update succeeds', async () => {
      const updatedTask = { ...sampleTask, status: 'dispatched' };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));
      mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockWhatsappNotifier.notifyTaskStarted).toHaveBeenCalledWith('user_123', updatedTask);
    });

    it('uses empty string as webhookSecret when task has no webhookSecret', async () => {
      const taskWithoutSecret = { ...sampleTask, webhookSecret: undefined };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(taskWithoutSecret));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        webhookSecret: '',
      }));
    });

    it('skips notification when task update fails after successful dispatch', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));
      mockCodeTaskRepo.update.mockResolvedValue(err({ code: 'internal_error', message: 'update failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockWhatsappNotifier.notifyTaskStarted).not.toHaveBeenCalled();
    });
  });

  describe('findResult error', () => {
    it('returns failed when findOldest fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(err({ code: 'internal_error', message: 'firestore down' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
    });
  });

  describe('TTL expired edge cases', () => {
    it('expires new_task and falls through to userId notification when task lookup fails', async () => {
      const expiredRetry = {
        ...sampleNewTaskRetry,
        userId: 'user_123',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(err({ code: 'not_found', message: 'task gone' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('expired');
      expect(result.value.taskId).toBe('task_xyz');
      // Falls through to userId notification since task lookup failed
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).toHaveBeenCalledWith('user_123', expect.objectContaining({
        repository: 'intexuraos/test-repo',
      }));
    });

    it('expires task_message type with userId notification', async () => {
      const expiredMessage = {
        ...sampleTaskMessageRetry,
        createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredMessage));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('expired');
      expect(result.value.taskId).toBe('task_xyz');
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).toHaveBeenCalledWith('user_123', expect.objectContaining({
        repository: 'intexuraos/test-repo',
      }));
    });

    it('expires entry without userId and without notification', async () => {
      const expiredNoUser = {
        ...sampleNewTaskRetry,
        taskId: undefined,
        userId: undefined,
        createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredNoUser));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('expired');
      expect(result.value.taskId).toBeUndefined();
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
    });
  });

  describe('max attempts exhausted edge cases', () => {
    it('exhausts new_task and falls through to userId notification when task lookup fails', async () => {
      const exhaustedRetry = {
        ...sampleNewTaskRetry,
        userId: 'user_123',
        attempts: 3,
        maxAttempts: 3,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(err({ code: 'not_found', message: 'task gone' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('exhausted');
      expect(result.value.taskId).toBe('task_xyz');
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).toHaveBeenCalledWith('user_123', expect.objectContaining({
        repository: 'intexuraos/test-repo',
        lastError: 'worker_unavailable',
      }));
    });

    it('exhausts task_message type with userId notification', async () => {
      const exhaustedMessage = {
        ...sampleTaskMessageRetry,
        attempts: 3,
        maxAttempts: 3,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedMessage));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('exhausted');
      expect(result.value.taskId).toBe('task_xyz');
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).toHaveBeenCalledWith('user_123', expect.objectContaining({
        repository: 'intexuraos/test-repo',
      }));
    });

    it('exhausts entry without userId and without notification', async () => {
      const exhaustedNoUser = {
        ...sampleNewTaskRetry,
        taskId: undefined,
        userId: undefined,
        attempts: 3,
        maxAttempts: 3,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedNoUser));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('exhausted');
      expect(result.value.taskId).toBeUndefined();
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
    });
  });

  describe('task_message retry', () => {
    it('sends message successfully and deletes retry entry', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('message_sent');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
      expect(mockLogLineRepo.storeBatch).toHaveBeenCalled();
    });

    it('increments attempts on retryable failure', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(err({ code: 'worker_unavailable', message: 'connection refused' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_def', expect.objectContaining({ attempts: 1 }));
    });

    it('returns failed when required fields are missing', async () => {
      const entryMissingFields = {
        ...sampleTaskMessageRetry,
        userId: undefined,
        taskId: undefined,
        message: undefined,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(entryMissingFields));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
    });

    it('returns retry_failed when worker settings fetch fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(err({ code: 'internal_error', message: 'db error' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_def', expect.objectContaining({
        lastError: 'Failed to fetch worker settings',
      }));
    });

    it('returns retry_failed when worker settings value is null', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(null));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_def', expect.objectContaining({
        lastError: 'Failed to fetch worker settings',
      }));
    });

    it('returns retry_failed when no enabled workers exist', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [{ ...workerConfig, enabled: false }] }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_def', expect.objectContaining({
        lastError: 'No enabled workers',
      }));
    });

    it('deletes entry on non-retryable send failure', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(err({ code: 'dispatch_failed', message: 'bad payload' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(result.value.taskId).toBe('task_xyz');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
    });
  });
});
