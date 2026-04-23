/**
 * Unit tests for handleTaskCompletion use case — the domain logic extracted
 * from `POST /internal/webhooks/task-complete`.
 *
 * These tests exercise the use case directly via `setServices({fakes} as unknown as ServiceContainer)`.
 * End-to-end coverage (HTTP + signature + auth) remains in
 * `__tests__/routes/webhooks.test.ts`, which is the authoritative regression
 * suite. The cases here pin the handler result contract + key side effects.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';

import {
  handleTaskCompletion,
  type TaskCompleteWebhookBody,
} from '../../../domain/usecases/handleTaskCompletion.js';
import { resetServices, setServices, type ServiceContainer } from '../../../services.js';
import type { TaskFormatterEntry } from '../../../domain/services/webhookHelpers.js';
import { ok, err } from '@intexuraos/common-core';
import { createMockLogger } from '../../helpers/mockLogger.js';

// Mock heavy downstream use cases — we only need to verify they are invoked.
vi.mock('../../../domain/usecases/drainTaskQueue.js', () => ({
  drainTaskQueue: vi.fn().mockResolvedValue({ ok: true, value: { action: 'empty' } }),
  _resetDrainGuard: vi.fn(),
}));
vi.mock('../../../domain/usecases/triageFailedTask.js', () => ({
  triageFailedTask: vi.fn().mockResolvedValue({ action: 'permanent_failure', reason: 'test' }),
}));

function buildRequestLog(): ReturnType<typeof createMockLogger> {
  return createMockLogger();
}

function buildInput(body: TaskCompleteWebhookBody): Parameters<typeof handleTaskCompletion>[1] {
  return {
    body,
    requestLog: buildRequestLog(),
    traceId: 'trace-1',
    taskFormatterStates: new Map<string, TaskFormatterEntry>(),
  };
}

describe('handleTaskCompletion', () => {
  afterEach(() => {
    resetServices();
    vi.clearAllMocks();
  });

  describe('task lookup', () => {
    it('returns fail/NOT_FOUND when the task cannot be resolved', async () => {
      setServices({
        codeTaskRepo: { findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'missing' })) } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);
      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-missing',
        status: 'completed',
      }));
      expect(result).toEqual({ kind: 'fail', code: 'NOT_FOUND', message: 'Task not found' });
    });
  });

  describe('stale cancelled callback', () => {
    it('returns received without updating when task is already cancelled and incoming status matches', async () => {
      const update = vi.fn();
      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'cancelled',
            agentType: 'execution',
          })),
          update,
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);
      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-cancel',
        status: 'cancelled',
      }));
      expect(result).toEqual({ kind: 'received' });
      expect(update).not.toHaveBeenCalled();
    });

    it('returns received without updating when task is already cancelled and incoming status differs', async () => {
      const update = vi.fn();
      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'cancelled',
            agentType: 'execution',
          })),
          update,
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);
      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-cancel',
        status: 'completed',
      }));
      expect(result).toEqual({ kind: 'received' });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('interrupted path', () => {
    it('updates the task, notifies, and returns received for an interrupted status', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const mirrorStatus = vi.fn().mockResolvedValue(undefined);
      const notifyTaskFailed = vi.fn().mockResolvedValue(ok(undefined));

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
            actionId: 'act-1',
            dispatchedAt: Timestamp.now(),
          })),
          update,
        } as never,
        statusMirrorService: { mirrorStatus } as never,
        whatsappNotifier: { notifyTaskFailed } as never,
        metricsClient: {
          incrementTasksCompleted: vi.fn().mockResolvedValue(undefined),
          recordTaskDuration: vi.fn().mockResolvedValue(undefined),
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-interrupted',
        status: 'interrupted',
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(update).toHaveBeenCalledWith(
        't-interrupted',
        expect.objectContaining({
          status: 'interrupted',
          error: { code: 'worker_interrupted', message: 'Worker was interrupted during task execution' },
          callbackReceived: true,
        }),
      );
      expect(mirrorStatus).toHaveBeenCalledWith(expect.objectContaining({ taskStatus: 'interrupted' }));
      expect(notifyTaskFailed).toHaveBeenCalled();
    });
  });

  describe('failed path', () => {
    it('returns received for a failed status with permanent_failure triage', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const mirrorStatus = vi.fn().mockResolvedValue(undefined);
      const notifyTaskFailed = vi.fn().mockResolvedValue(ok(undefined));

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
            actionId: 'act-1',
          })),
          update,
        } as never,
        statusMirrorService: { mirrorStatus } as never,
        whatsappNotifier: { notifyTaskFailed } as never,
        metricsClient: {
          incrementTasksCompleted: vi.fn().mockResolvedValue(undefined),
          recordTaskDuration: vi.fn().mockResolvedValue(undefined),
        } as never,
        automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
        taskEnqueueService: {} as never,
        logLineRepo: {} as never,
        userServiceClient: {} as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-failed',
        status: 'failed',
        error: { code: 'EXECUTION_AGENT_CRASH', message: 'boom' },
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(update).toHaveBeenCalledWith(
        't-failed',
        expect.objectContaining({
          status: 'failed',
          callbackReceived: true,
          error: expect.objectContaining({ code: 'EXECUTION_AGENT_CRASH', message: 'boom' }),
        }),
      );
      expect(notifyTaskFailed).toHaveBeenCalled();
    });
  });
});
