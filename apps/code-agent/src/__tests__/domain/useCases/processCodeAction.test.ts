/**
 * Tests for processCodeAction use case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../../domain/services/taskDispatcher.js';
import type { Logger } from 'pino';
import { processCodeAction } from '../../../domain/usecases/processCodeAction.js';

describe('processCodeAction', () => {
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    codeTaskRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByIdForUser: vi.fn(),
      update: vi.fn(),
    } as unknown as CodeTaskRepository;

    taskDispatcher = {
      dispatch: vi.fn(),
    } as unknown as TaskDispatcherService;
  });

  it('returns internal_error for non-duplication repository errors', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Firestore unavailable' })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('Firestore unavailable');
    }
  });

  it('returns duplicate_approval for DUPLICATE_APPROVAL errors', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({
        code: 'DUPLICATE_APPROVAL',
        message: 'Task already exists for this approval',
        existingTaskId: 'existing-task-123',
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('duplicate_approval');
      expect(result.error.existingTaskId).toBe('existing-task-123');
    }
  });

  it('returns duplicate_action for DUPLICATE_ACTION errors', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({
        code: 'DUPLICATE_ACTION',
        message: 'Task already exists for this action',
        existingTaskId: 'existing-task-456',
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('duplicate_action');
      expect(result.error.existingTaskId).toBe('existing-task-456');
    }
  });

  it('successfully creates task and dispatches to worker', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-123',
        userId: 'user-789',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'hash-123',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace-123',
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        status: 'dispatched',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    vi.mocked(taskDispatcher.dispatch).mockResolvedValueOnce(
      ok({
        dispatched: true,
        workerLocation: 'mac',
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.codeTaskId).toBe('new-task-123');
      expect(result.value.resourceUrl).toBe('/#/code-tasks/new-task-123');
      expect(result.value.workerLocation).toBe('mac');
    }
  });

  it('updates task error and returns worker_unavailable on dispatch failure', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-123',
        userId: 'user-789',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'hash-123',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace-123',
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        status: 'dispatched',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    vi.mocked(taskDispatcher.dispatch).mockResolvedValueOnce(
      err({
        code: 'worker_unavailable',
        message: 'No workers available',
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('worker_unavailable');
      expect(result.error.message).toBe('No workers available');
    }

    // Verify task was updated with error
    expect(codeTaskRepo.update).toHaveBeenCalledWith('new-task-123', {
      error: {
        code: 'worker_unavailable',
        message: 'No workers available',
      },
    });
  });
});
