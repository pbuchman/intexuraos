/**
 * Tests for sendTaskMessage use case.
 *
 * Test Requirements:
 * 1. Returns task_not_found when task doesn't exist
 * 2. Returns invalid_status for queued task
 * 3. Queues message locally for dispatched task (stores in pendingUserMessages, no worker contact)
 * 4. Queues message for running task (writes log line, forwards to worker, returns { action: 'queued' })
 * 5. Resumes completed task with message (writes log line, forwards to worker, returns { action: 'resumed' })
 * 6. Returns worker_not_configured when no workers are configured
 * 7. Returns worker_error when forwarding to worker fails
 * 8. Continues even if log line write fails (non-fatal)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { StatusMirrorService } from '../../../domain/services/statusMirrorService.js';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';
import {
  sendTaskMessage,
  type SendTaskMessageDeps,
} from '../../../domain/usecases/sendTaskMessage.js';

describe('sendTaskMessage', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findByIdForUser: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockLogLineRepo: {
    storeBatch: ReturnType<typeof vi.fn>;
  };
  let mockTaskDispatcher: {
    sendMessageToWorker: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockStatusMirrorService: {
    mirrorStatus: ReturnType<typeof vi.fn>;
  };
  let mockWhatsappNotifier: {
    notifyTaskResumed: ReturnType<typeof vi.fn>;
  };

  const userId = 'user-123';
  const taskId = 'task-abc';
  const message = 'Please fix the tests';

  const workerConfig = {
    name: 'home-mac',
    url: 'https://worker.local',
    cfAccessClientId: 'client-id',
    cfAccessClientSecret: 'client-secret',
    dispatchSigningSecret: 'signing-secret',
    enabled: true,
  };

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
      update: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockLogLineRepo = {
      storeBatch: vi.fn(),
    };

    mockTaskDispatcher = {
      sendMessageToWorker: vi.fn(),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };

    mockStatusMirrorService = {
      mirrorStatus: vi.fn().mockResolvedValue(undefined),
    };

    mockWhatsappNotifier = {
      notifyTaskResumed: vi.fn().mockResolvedValue(ok(undefined)),
    };
  });

  function createMockTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    const task: CodeTask = {
      id: taskId,
      userId,
      traceId: 'trace-123',
      prompt: 'Original prompt',
      sanitizedPrompt: 'Original prompt',
      systemPromptHash: 'hash-123',
      workerType: 'auto',
      workerLocation: 'home-mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'running',
      dedupKey: 'dedup-123',
      callbackReceived: false,
      createdAt: now,
      updatedAt: now,
    };

    // Apply overrides, but skip undefined values to avoid exactOptionalPropertyTypes issues
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        (task as unknown as Record<string, unknown>)[key] = value;
      }
    }

    return task;
  }

  function createDeps(): SendTaskMessageDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as SendTaskMessageDeps['codeTaskRepo'],
      logLineRepo: mockLogLineRepo as unknown as SendTaskMessageDeps['logLineRepo'],
      taskDispatcher: mockTaskDispatcher as unknown as SendTaskMessageDeps['taskDispatcher'],
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as SendTaskMessageDeps['workerSettingsRepo'],
      statusMirrorService: mockStatusMirrorService as unknown as StatusMirrorService,
      whatsappNotifier: mockWhatsappNotifier as unknown as WhatsAppNotifier,
    };
  }

  function setupWorkerSettings(workers = [workerConfig]): void {
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(
      ok({
        userId,
        workers,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
  }

  function setupSuccessPath(taskOverrides: Partial<CodeTask> = {}, action: 'queued' | 'resumed' = 'queued'): void {
    const task = createMockTask(taskOverrides);
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
    mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
    setupWorkerSettings();
    mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action }));
  }

  describe('validation', () => {
    it('should return task_not_found when task does not exist', async () => {
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Task not found' })
      );

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task_not_found');
        expect(result.error.message).toContain(taskId);
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId, userId }),
        expect.any(String)
      );
    });

    it('should return invalid_status for queued task', async () => {
      const queuedTask = createMockTask({ status: 'queued' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(queuedTask));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
        expect(result.error.message).toContain('queued');
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId, status: 'queued' }),
        expect.any(String)
      );
    });

    it('should queue message locally for dispatched task without contacting worker', async () => {
      const dispatchedTask = createMockTask({ status: 'dispatched' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(dispatchedTask));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.update.mockResolvedValue(ok(undefined));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('queued');
      }

      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(taskId, { pendingUserMessages: [message] });
      expect(mockTaskDispatcher.sendMessageToWorker).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId, action: 'queued', status: 'dispatched' }),
        expect.any(String)
      );
    });

    it('should append to existing pendingUserMessages for dispatched task', async () => {
      const dispatchedTask = createMockTask({
        status: 'dispatched',
        pendingUserMessages: ['First message'],
      });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(dispatchedTask));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      mockCodeTaskRepo.update.mockResolvedValue(ok(undefined));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(taskId, {
        pendingUserMessages: ['First message', message],
      });
    });

    it('should succeed for dispatched task even if log line write fails', async () => {
      const dispatchedTask = createMockTask({ status: 'dispatched' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(dispatchedTask));
      mockLogLineRepo.storeBatch.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Write failed' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(undefined));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('queued');
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.stringContaining('Failed to store user message log line')
      );
    });

    it('should succeed for dispatched task even if pendingUserMessages update fails', async () => {
      const dispatchedTask = createMockTask({ status: 'dispatched' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(dispatchedTask));
      mockLogLineRepo.storeBatch
        .mockResolvedValueOnce(ok(undefined))
        .mockResolvedValueOnce(ok(undefined));
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Write failed' })
      );

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.stringContaining('Failed to update pending user messages')
      );
    });

    it('should succeed for dispatched task even if status log line write fails', async () => {
      const dispatchedTask = createMockTask({ status: 'dispatched' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(dispatchedTask));
      mockLogLineRepo.storeBatch
        .mockResolvedValueOnce(ok(undefined))
        .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }));
      mockCodeTaskRepo.update.mockResolvedValue(ok(undefined));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.stringContaining('Failed to write status log line')
      );
    });
  });

  describe('successful message sending', () => {
    it('should queue message for running task', async () => {
      setupSuccessPath({ status: 'running' }, 'queued');

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('queued');
      }

      // Verify log line was written
      expect(mockLogLineRepo.storeBatch).toHaveBeenCalledWith(taskId, [
        expect.objectContaining({
          text: `[user] ${message}`,
          timestamp: expect.any(Timestamp),
          sequence: expect.any(Number),
        }),
      ]);

      // Verify message was forwarded to worker
      expect(mockTaskDispatcher.sendMessageToWorker).toHaveBeenCalledWith(
        taskId,
        message,
        {
          url: workerConfig.url,
          cfAccessClientId: workerConfig.cfAccessClientId,
          cfAccessClientSecret: workerConfig.cfAccessClientSecret,
          dispatchSigningSecret: workerConfig.dispatchSigningSecret,
        }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId, action: 'queued' }),
        expect.any(String)
      );
    });

    it('should resume completed task with message', async () => {
      setupSuccessPath({ status: 'planned' }, 'resumed');

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('resumed');
      }

      expect(mockLogLineRepo.storeBatch).toHaveBeenCalledWith(taskId, [
        expect.objectContaining({
          text: `[user] ${message}`,
        }),
      ]);

      expect(mockTaskDispatcher.sendMessageToWorker).toHaveBeenCalledWith(
        taskId,
        message,
        expect.objectContaining({
          url: workerConfig.url,
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId, action: 'resumed' }),
        expect.any(String)
      );
    });

    it('should use worker matching task workerLocation', async () => {
      const secondWorker = {
        name: 'office-pc',
        url: 'https://office-worker.local',
        cfAccessClientId: 'office-client-id',
        cfAccessClientSecret: 'office-client-secret',
        dispatchSigningSecret: 'office-signing-secret',
        enabled: true,
      };

      const task = createMockTask({ status: 'running', workerLocation: 'office-pc' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          userId,
          workers: [workerConfig, secondWorker],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'queued' }));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      expect(mockTaskDispatcher.sendMessageToWorker).toHaveBeenCalledWith(
        taskId,
        message,
        {
          url: secondWorker.url,
          cfAccessClientId: secondWorker.cfAccessClientId,
          cfAccessClientSecret: secondWorker.cfAccessClientSecret,
          dispatchSigningSecret: secondWorker.dispatchSigningSecret,
        }
      );
    });

    it('should fall back to first enabled worker when workerLocation does not match', async () => {
      const task = createMockTask({ status: 'running', workerLocation: 'nonexistent-worker' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'queued' }));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      expect(mockTaskDispatcher.sendMessageToWorker).toHaveBeenCalledWith(
        taskId,
        message,
        {
          url: workerConfig.url,
          cfAccessClientId: workerConfig.cfAccessClientId,
          cfAccessClientSecret: workerConfig.cfAccessClientSecret,
          dispatchSigningSecret: workerConfig.dispatchSigningSecret,
        }
      );
    });
  });

  describe('worker configuration errors', () => {
    it('should return worker_not_configured when no workers are configured', async () => {
      const task = createMockTask({ status: 'running' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          userId,
          workers: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
        expect(result.error.message).toContain('No workers configured');
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId }),
        expect.any(String)
      );
    });

    it('should return worker_not_configured when all workers are disabled', async () => {
      const task = createMockTask({ status: 'running' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          userId,
          workers: [{ ...workerConfig, enabled: false }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
      }
    });

    it('should return worker_not_configured when settings are null', async () => {
      const task = createMockTask({ status: 'running' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(null));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
      }
    });
  });

  describe('worker forwarding errors', () => {
    it('should return worker_error when forwarding to worker fails', async () => {
      const task = createMockTask({ status: 'running' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
        err({ code: 'dispatch_failed', message: 'Worker returned 500' })
      );

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_error');
        expect(result.error.message).toBe('Worker returned 500');
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.any(String)
      );
    });
  });

  describe('graceful degradation', () => {
    it('should continue even if log line write fails (non-fatal)', async () => {
      const task = createMockTask({ status: 'running' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockLogLineRepo.storeBatch.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Write failed' })
      );
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'queued' }));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      // Should succeed despite log write failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('queued');
      }

      // Should have logged the error
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.stringContaining('Failed to store user message log line')
      );

      // Should still forward to worker
      expect(mockTaskDispatcher.sendMessageToWorker).toHaveBeenCalled();
    });
  });

  describe('terminal statuses that allow messaging', () => {
    it('should allow messaging for failed task', async () => {
      setupSuccessPath({ status: 'failed' }, 'resumed');

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('resumed');
      }
    });

    it('should allow messaging for interrupted task', async () => {
      setupSuccessPath({ status: 'interrupted' }, 'resumed');

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('resumed');
      }
    });

    it('should allow messaging for cancelled task', async () => {
      setupSuccessPath({ status: 'cancelled' }, 'resumed');

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('resumed');
      }
    });
  });

  describe('status log lines', () => {
    it('should write single [queued] acknowledgment log line when action is queued', async () => {
      setupSuccessPath({ status: 'running' }, 'queued');

      await sendTaskMessage(createDeps(), { taskId, userId, message });

      // storeBatch is called twice: once for [user], once for [queued] acknowledgment only
      expect(mockLogLineRepo.storeBatch).toHaveBeenCalledTimes(2);
      const secondCall = mockLogLineRepo.storeBatch.mock.calls[1];
      expect(secondCall?.[0]).toBe(taskId);
      expect(secondCall?.[1]).toEqual([
        expect.objectContaining({
          text: '[queued] Message queued \u2014 will be delivered when current work completes',
          timestamp: expect.any(Timestamp),
        }),
      ]);
    });

    it('should append [resumed] marker when action is resumed without duplicating [user] line', async () => {
      setupSuccessPath({ status: 'planned' }, 'resumed');

      await sendTaskMessage(createDeps(), { taskId, userId, message });

      // storeBatch is called twice: once for [user] (step 3), once for [resumed] only
      expect(mockLogLineRepo.storeBatch).toHaveBeenCalledTimes(2);
      const secondCall = mockLogLineRepo.storeBatch.mock.calls[1];
      expect(secondCall?.[0]).toBe(taskId);
      expect(secondCall?.[1]).toEqual([
        expect.objectContaining({
          text: `[resumed] Task resuming with your message: ${message}`,
          timestamp: expect.any(Timestamp),
        }),
      ]);
    });

    it('should use sequence + 1 for status log line', async () => {
      setupSuccessPath({ status: 'running' }, 'queued');

      await sendTaskMessage(createDeps(), { taskId, userId, message });

      const firstCall = mockLogLineRepo.storeBatch.mock.calls[0];
      const secondCall = mockLogLineRepo.storeBatch.mock.calls[1];
      const userSequence = (firstCall?.[1] as { sequence: number }[])[0]?.sequence;
      const statusSequence = (secondCall?.[1] as { sequence: number }[])[0]?.sequence;
      expect(statusSequence).toBe((userSequence ?? 0) + 1);
    });

    it('should succeed even if status log line write fails (best-effort)', async () => {
      const task = createMockTask({ status: 'running' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      // First storeBatch (user line) succeeds, second (status line) fails
      mockLogLineRepo.storeBatch
        .mockResolvedValueOnce(ok(undefined))
        .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'queued' }));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('queued');
      }
    });

    it('should succeed even if pendingUserMessages update fails (best-effort)', async () => {
      const task = createMockTask({ status: 'running' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'queued' }));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.stringContaining('Failed to update pending user messages')
      );
    });

    it('should succeed even if resumed status log write fails (best-effort)', async () => {
      const task = createMockTask({ status: 'planned' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update.mockResolvedValue(ok(undefined));
      // First storeBatch (user line) succeeds, second ([resumed] marker) fails
      mockLogLineRepo.storeBatch
        .mockResolvedValueOnce(ok(undefined))
        .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.stringContaining('Failed to write status log line')
      );
    });
  });

  describe('resume side-effects', () => {
    it('should update Firestore status to running on resume', async () => {
      const task = createMockTask({ status: 'planned', actionId: 'action-1' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update = vi.fn().mockResolvedValue(ok(undefined));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(taskId, { status: 'running', error: null, pendingUserMessages: [] });
    });

    it('should mirror status to running on resume', async () => {
      const task = createMockTask({ status: 'planned', actionId: 'action-1', traceId: 'trace-abc' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update = vi.fn().mockResolvedValue(ok(undefined));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));

      await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(mockStatusMirrorService.mirrorStatus).toHaveBeenCalledWith({
        actionId: 'action-1',
        taskStatus: 'running',
        traceId: 'trace-abc',
      });
    });

    it('should send WhatsApp notification on resume', async () => {
      const task = createMockTask({ status: 'planned' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update = vi.fn().mockResolvedValue(ok(undefined));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));

      await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(mockWhatsappNotifier.notifyTaskResumed).toHaveBeenCalledWith(userId, task);
    });

    it('should not call resume side-effects when action is queued', async () => {
      setupSuccessPath({ status: 'running' }, 'queued');

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      // update IS called to save pendingUserMessages, but NOT for status/mirror/whatsapp
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(taskId, { pendingUserMessages: [message] });
      expect(mockStatusMirrorService.mirrorStatus).not.toHaveBeenCalled();
      expect(mockWhatsappNotifier.notifyTaskResumed).not.toHaveBeenCalled();
    });

    it('should succeed even if Firestore status update fails (best-effort)', async () => {
      const task = createMockTask({ status: 'planned' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update = vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('resumed');
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.stringContaining('Failed to update task status')
      );
    });

    it('should succeed even if status mirror fails (best-effort)', async () => {
      const task = createMockTask({ status: 'planned', actionId: 'action-1' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update = vi.fn().mockResolvedValue(ok(undefined));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));
      mockStatusMirrorService.mirrorStatus.mockRejectedValueOnce(new Error('Mirror failed'));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('resumed');
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.stringContaining('Failed to mirror resumed status')
      );
    });

    it('should succeed even if WhatsApp notification fails (best-effort)', async () => {
      const task = createMockTask({ status: 'planned' });
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update = vi.fn().mockResolvedValue(ok(undefined));
      mockLogLineRepo.storeBatch.mockResolvedValue(ok(undefined));
      setupWorkerSettings();
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));
      mockWhatsappNotifier.notifyTaskResumed.mockRejectedValueOnce(new Error('Notification failed'));

      const result = await sendTaskMessage(createDeps(), { taskId, userId, message });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('resumed');
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId }),
        expect.stringContaining('Failed to send resumed notification')
      );
    });
  });
});
