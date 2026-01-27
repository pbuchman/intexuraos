/**
 * Tests for processCodeAction use case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../../domain/services/taskDispatcher.js';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';
import type { Logger } from 'pino';
import { processCodeAction } from '../../../domain/usecases/processCodeAction.js';

describe('processCodeAction', () => {
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let whatsappNotifier: WhatsAppNotifier;

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

    whatsappNotifier = {
      notifyTaskComplete: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskFailed: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskStarted: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as WhatsAppNotifier;
  });

  it('returns internal_error for non-duplication repository errors', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Firestore unavailable' })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, whatsappNotifier },
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
      { logger, codeTaskRepo, taskDispatcher, whatsappNotifier },
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
      { logger, codeTaskRepo, taskDispatcher, whatsappNotifier },
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

    // Mock update for cancel nonce
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
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
        cancelNonce: 'abcd',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, whatsappNotifier },
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

    // Verify cancel nonce was set
    expect(codeTaskRepo.update).toHaveBeenCalledWith('new-task-123', {
      cancelNonce: expect.any(String),
      cancelNonceExpiresAt: expect.any(String),
    });

    // Verify notification was sent
    expect(whatsappNotifier.notifyTaskStarted).toHaveBeenCalledWith('user-789', expect.any(Object));
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
      { logger, codeTaskRepo, taskDispatcher, whatsappNotifier },
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

  it('successfully creates task with linearIssueId when provided', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-456',
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
        linearIssueId: 'INT-305',
      })
    );

    vi.mocked(taskDispatcher.dispatch).mockResolvedValueOnce(
      ok({
        dispatched: true,
        workerLocation: 'vm',
      })
    );

    // Mock update for cancel nonce
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({
        id: 'new-task-456',
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
        linearIssueId: 'INT-305',
        cancelNonce: 'ef01',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, whatsappNotifier },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
        linearIssueId: 'INT-305',
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.codeTaskId).toBe('new-task-456');
      expect(result.value.workerLocation).toBe('vm');
    }
  });

  it('successfully creates task with custom repository when provided', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-789',
        userId: 'user-789',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'hash-123',
        workerType: 'auto',
        workerLocation: 'vm',
        repository: 'custom/repo',
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
        workerLocation: 'vm',
      })
    );

    // Mock update for cancel nonce
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({
        id: 'new-task-789',
        userId: 'user-789',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'hash-123',
        workerType: 'auto',
        workerLocation: 'vm',
        repository: 'custom/repo',
        baseBranch: 'development',
        traceId: 'trace-123',
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        status: 'dispatched',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        cancelNonce: '2345',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, whatsappNotifier },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
        repository: 'custom/repo',
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.codeTaskId).toBe('new-task-789');
      expect(result.value.workerLocation).toBe('vm');
    }
  });

  it('succeeds even if nonce update fails (graceful degradation)', async () => {
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

    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, whatsappNotifier },
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
    }

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'new-task-123' }),
      'Failed to update task with cancel nonce'
    );

    expect(whatsappNotifier.notifyTaskStarted).not.toHaveBeenCalled();
  });

  it('succeeds even if notification fails (graceful degradation)', async () => {
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

    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
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
        cancelNonce: 'abcd',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
    );

    vi.mocked(whatsappNotifier.notifyTaskStarted).mockResolvedValueOnce(
      err({ code: 'notification_failed', message: 'WhatsApp unreachable' })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, whatsappNotifier },
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
    }

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'new-task-123' }),
      'Failed to send task started notification'
    );
  });
});
