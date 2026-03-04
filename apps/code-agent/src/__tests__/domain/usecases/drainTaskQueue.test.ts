/**
 * Tests for drainTaskQueue use case.
 *
 * INT-619: Task queueing when workers are at capacity.
 *
 * Test Requirements:
 * 1. Empty queue → returns { action: 'empty' }
 * 2. TTL expired → marks task failed with queue_timeout, calls notifyTaskQueueExpired
 * 3. Workers still busy (dispatch error) → returns { action: 'still_busy', taskId }
 * 4. Successful dispatch → updates to dispatched, sets cancel nonce, calls notifyTaskStarted
 * 5. Concurrent drain → second call returns { action: 'skipped' }
 * 6. No enabled workers → returns { action: 'still_busy' }
 * 7. Worker settings fetch fails → returns err with internal_error
 * 8. findOldestQueued fails → returns err with internal_error
 * 9. Fresh Linear labels fetched at drain time
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import {
  drainTaskQueue,
  _resetDrainGuard,
  type DrainTaskQueueDeps,
} from '../../../domain/usecases/drainTaskQueue.js';

// Mock config
vi.mock('../../../config.js', () => ({
  loadConfig: (): { queue: { maxSize: number; ttlMinutes: number }; serviceUrl: string } => ({
    queue: { maxSize: 10, ttlMinutes: 30 },
    serviceUrl: 'https://code-agent.test',
  }),
}));

// Mock secrets
vi.mock('../../../domain/utils/secrets.js', () => ({
  generateCancelNonce: (): string => 'abcd1234',
  CANCEL_NONCE_TTL_MS: 15 * 60 * 1000,
}));

describe('drainTaskQueue', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findOldestQueued: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    countQueued: ReturnType<typeof vi.fn>;
  };
  let mockTaskDispatcher: {
    dispatch: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    validateIssue: ReturnType<typeof vi.fn>;
  };
  let mockWhatsappNotifier: {
    notifyTaskStarted: ReturnType<typeof vi.fn>;
    notifyTaskQueueExpired: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockLockDeleteFn: ReturnType<typeof vi.fn>;
  let mockFirestore: {
    doc: ReturnType<typeof vi.fn>;
  };

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
      findOldestQueued: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      countQueued: vi.fn(),
    };

    mockTaskDispatcher = {
      dispatch: vi.fn(),
    };

    mockLinearAgentClient = {
      validateIssue: vi.fn(),
    };

    mockWhatsappNotifier = {
      notifyTaskStarted: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskQueueExpired: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };

    mockLockDeleteFn = vi.fn().mockResolvedValue(undefined);
    mockFirestore = {
      doc: vi.fn().mockReturnValue({ delete: mockLockDeleteFn }),
    };
  });

  afterEach(() => {
    _resetDrainGuard();
  });

  function createMockTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    const task: CodeTask = {
      id: 'task-123',
      userId: 'user-456',
      traceId: 'trace-789',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'hash-abc',
      workerType: 'auto',
      workerLocation: '',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'queued',
      dedupKey: 'dedup-xyz',
      callbackReceived: false,
      createdAt: now,
      updatedAt: now,
      queuedAt: now,
      webhookSecret: 'webhook-secret-123',
    };

    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        (task as unknown as Record<string, unknown>)[key] = value;
      }
    }

    return task;
  }

  function createDeps(): DrainTaskQueueDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as DrainTaskQueueDeps['codeTaskRepo'],
      taskDispatcher: mockTaskDispatcher as unknown as DrainTaskQueueDeps['taskDispatcher'],
      linearAgentClient: mockLinearAgentClient as unknown as DrainTaskQueueDeps['linearAgentClient'],
      whatsappNotifier: mockWhatsappNotifier as unknown as DrainTaskQueueDeps['whatsappNotifier'],
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as DrainTaskQueueDeps['workerSettingsRepo'],
      firestore: mockFirestore as unknown as DrainTaskQueueDeps['firestore'],
    };
  }

  function setupWorkerSettings(workers = [workerConfig]): void {
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(
      ok({
        userId: 'user-456',
        workers,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
  }

  it('returns empty when no queued tasks exist', async () => {
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(null));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'empty' });
    }
  });

  it('returns err with internal_error when findOldestQueued fails', async () => {
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'Database unavailable' })
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('Database unavailable');
    }
  });

  it('expires task when TTL exceeded, marks failed, and notifies', async () => {
    // Create a task queued 31 minutes ago (TTL is 30 minutes)
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(thirtyOneMinutesAgo),
    });
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'expired', taskId: 'task-123' });
    }

    // Verify task marked as failed
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', {
      status: 'failed',
      error: {
        code: 'queue_timeout',
        message: 'Task expired in queue after 30 minutes. Workers were still busy.',
      },
    });

    // Verify notification sent
    expect(mockWhatsappNotifier.notifyTaskQueueExpired).toHaveBeenCalledWith('user-456', task);
  });

  it('clears parent implementationTaskId when expired task has parentTaskId', async () => {
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(thirtyOneMinutesAgo),
      parentTaskId: 'parent-task-1',
    });
    const parentTask = createMockTask({
      id: 'parent-task-1',
      status: 'planned',
      implementationTaskId: 'task-123',
    });

    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    mockCodeTaskRepo.findById.mockResolvedValue(ok(parentTask));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'expired', taskId: 'task-123' });
    }

    // Verify findById was called for parent
    expect(mockCodeTaskRepo.findById).toHaveBeenCalledWith('parent-task-1');

    // Verify implementationTaskId was cleared on parent
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('parent-task-1', { implementationTaskId: null });
  });

  it('does not clear parent implementationTaskId when it points to a different task', async () => {
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(thirtyOneMinutesAgo),
      parentTaskId: 'parent-task-1',
    });
    const parentTask = createMockTask({
      id: 'parent-task-1',
      status: 'planned',
      implementationTaskId: 'different-task-999',
    });

    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    mockCodeTaskRepo.findById.mockResolvedValue(ok(parentTask));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'expired', taskId: 'task-123' });
    }

    // Verify implementationTaskId was NOT cleared (parent points to different task)
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith('parent-task-1', { implementationTaskId: null });
  });

  it('logs warning when clearing parent implementationTaskId fails', async () => {
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(thirtyOneMinutesAgo),
      parentTaskId: 'parent-task-1',
    });
    const parentTask = createMockTask({
      id: 'parent-task-1',
      status: 'planned',
      implementationTaskId: 'task-123',
    });

    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    mockCodeTaskRepo.findById.mockResolvedValue(ok(parentTask));
    // First call: mark task as failed (succeeds), second call: clear parent (fails)
    mockCodeTaskRepo.update
      .mockResolvedValueOnce(ok(task))
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'expired', taskId: 'task-123' });
    }

    // Verify warning was logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: 'parent-task-1', expiredTaskId: 'task-123' }),
      'Failed to clear implementationTaskId on parent task after queue expiry'
    );
  });

  it('logs warning when notifyTaskQueueExpired fails', async () => {
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(thirtyOneMinutesAgo),
    });

    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));
    mockWhatsappNotifier.notifyTaskQueueExpired.mockResolvedValue(
      err({ code: 'SEND_FAILED', message: 'WhatsApp down' })
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'expired', taskId: 'task-123' });
    }

    // Verify warning was logged about notification failure
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123' }),
      'Failed to send queue expired notification'
    );
  });

  it('uses createdAt when queuedAt is not set for TTL check', async () => {
    // Create a task with createdAt 31 minutes ago and no queuedAt
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask();
    // Remove queuedAt to test fallback to createdAt
    delete (task as unknown as Record<string, unknown>)['queuedAt'];
    (task as unknown as Record<string, unknown>)['createdAt'] = Timestamp.fromDate(thirtyOneMinutesAgo);

    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'expired', taskId: 'task-123' });
    }
  });

  it('returns err with internal_error when worker settings fetch fails', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));

    mockWorkerSettingsRepo.getSettings.mockResolvedValue(
      err({ code: 'internal_error', message: 'Settings unavailable' })
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('Failed to fetch worker settings');
    }
  });

  it('returns err with internal_error when worker settings returns null', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));

    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(null));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('Failed to fetch worker settings');
    }
  });

  it('returns still_busy when user has no enabled workers', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));

    setupWorkerSettings([{ ...workerConfig, enabled: false }]);

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
    }
  });

  it('returns still_busy when dispatch fails (workers busy)', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'at_capacity', message: 'All workers busy' })
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
    }
  });

  it('fails task when dispatch returns non-capacity error', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'network_error', message: 'Connection refused' })
    );

    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'failed', taskId: 'task-123' });
    }

    // Verify task was marked as failed with the dispatch error
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', {
      status: 'failed',
      error: {
        code: 'network_error',
        message: expect.stringContaining('Connection refused'),
      },
    });
  });

  it('logs error when fail-status update itself fails during non-capacity error', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'network_error', message: 'Connection refused' })
    );

    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'Firestore write failed' })
    );

    const result = await drainTaskQueue(createDeps());

    // Still returns failed action even if update didn't persist
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'failed', taskId: 'task-123' });
    }

    // Verify error was logged about the failed update
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123' }),
      'Failed to persist failed status during drain'
    );
  });

  it('dispatches successfully and updates task status', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );

    const updatedTask = createMockTask({ status: 'dispatched', workerLocation: 'home-mac' });
    mockCodeTaskRepo.update.mockResolvedValue(ok(updatedTask));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
    }

    // Verify task updated with dispatched status, cancel nonce, and worker location
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', {
      status: 'dispatched',
      dispatchedAt: expect.any(Date),
      workerLocation: 'home-mac',
      cancelNonce: 'abcd1234',
      cancelNonceExpiresAt: expect.any(String),
    });

    // Verify notification sent
    expect(mockWhatsappNotifier.notifyTaskStarted).toHaveBeenCalledWith('user-456', updatedTask);
  });

  it('dispatches with correct webhook URL and task fields', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith({
      taskId: 'task-123',
      prompt: 'Fix the bug',
      systemPromptHash: 'hash-abc',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      workerType: 'auto',
      webhookUrl: 'https://code-agent.test/internal/webhooks/task-complete',
      webhookSecret: 'webhook-secret-123',
      traceId: 'trace-789',
      workerCredentials: {
        workers: [{
          name: 'home-mac',
          url: 'https://worker.local',
          cfAccessClientId: 'client-id',
          cfAccessClientSecret: 'client-secret',
          dispatchSigningSecret: 'signing-secret',
        }],
      },
      linearIssueLabels: [],
      hasChildren: false,
      agentType: 'planning',
    });
  });

  it('dispatches with empty webhookSecret when task has no webhookSecret', async () => {
    const task = createMockTask();
    // Remove webhookSecret to test the ?? '' fallback
    delete (task as unknown as Record<string, unknown>)['webhookSecret'];
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookSecret: '',
      })
    );
  });

  it('fetches fresh Linear labels when task has linearIssueId', async () => {
    const task = createMockTask({ linearIssueId: 'INT-123' });
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockLinearAgentClient.validateIssue.mockResolvedValue(
      ok({
        id: 'issue-id',
        identifier: 'INT-123',
        title: 'Test issue',
        url: 'https://linear.app/intexura/issue/INT-123',
        labels: ['bug', 'high-priority'],
        childCount: 2,
      })
    );

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    // Verify validateIssue was called
    expect(mockLinearAgentClient.validateIssue).toHaveBeenCalledWith({
      userId: 'user-456',
      identifier: 'INT-123',
    });

    // Verify dispatch includes the fresh labels and linearIssueId
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueLabels: ['bug', 'high-priority'],
        hasChildren: true,
        linearIssueId: 'INT-123',
      })
    );
  });

  it('continues with empty labels when Linear validation fails', async () => {
    const task = createMockTask({ linearIssueId: 'INT-123' });
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockLinearAgentClient.validateIssue.mockResolvedValue(
      err({ code: 'UNAVAILABLE', message: 'Linear down' })
    );

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    // Should still dispatch with empty labels
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueLabels: [],
        hasChildren: false,
        linearIssueId: 'INT-123',
      })
    );
  });

  it('does not call notifyTaskStarted when update fails', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );

    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
    );

    const result = await drainTaskQueue(createDeps());

    // Still returns dispatched (dispatch succeeded)
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
    }

    // Should NOT have called notifyTaskStarted since update failed
    expect(mockWhatsappNotifier.notifyTaskStarted).not.toHaveBeenCalled();
  });

  it('returns skipped when concurrent drain is in progress', async () => {
    // Create a promise that won't resolve immediately to simulate in-progress drain
    let resolveFind!: (value: unknown) => void;
    const pendingFind = new Promise((resolve) => {
      resolveFind = resolve;
    });
    mockCodeTaskRepo.findOldestQueued.mockReturnValue(pendingFind);

    // Start first drain (will be stuck waiting for findOldestQueued)
    const firstDrain = drainTaskQueue(createDeps());

    // Start second drain while first is in progress
    const secondResult = await drainTaskQueue(createDeps());

    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(secondResult.value).toEqual({ action: 'skipped' });
    }

    // Resolve the first drain so it completes
    resolveFind(ok(null));
    const firstResult = await firstDrain;

    expect(firstResult.ok).toBe(true);
    if (firstResult.ok) {
      expect(firstResult.value).toEqual({ action: 'empty' });
    }
  });

  it('resets drain guard even if an error is thrown', async () => {
    mockCodeTaskRepo.findOldestQueued.mockRejectedValue(new Error('Unexpected error'));

    await expect(drainTaskQueue(createDeps())).rejects.toThrow('Unexpected error');

    // Guard should be reset, so next call should not return 'skipped'
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(null));
    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'empty' });
    }
  });

  it('uses agentType from task when available', async () => {
    const task = createMockTask({ agentType: 'execution' });
    mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'execution',
      })
    );
  });

  describe('PR task lock cleanup', () => {
    it('deletes PR task lock on TTL expiry (PR task)', async () => {
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
      const task = createMockTask({
        queuedAt: Timestamp.fromDate(thirtyOneMinutesAgo),
        prNumber: 42,
      });
      mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'expired', taskId: 'task-123' });
      }
      // Verify lock deletion was called
      expect(mockFirestore.doc).toHaveBeenCalledWith('pr_task_locks/pbuchman_intexuraos_42');
      expect(mockLockDeleteFn).toHaveBeenCalled();
    });

    it('deletes PR task lock on dispatch failure (PR task)', async () => {
      const task = createMockTask({ prNumber: 42 });
      mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'network_error', message: 'Connection refused' })
      );

      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'failed', taskId: 'task-123' });
      }
      // Verify lock deletion was called
      expect(mockFirestore.doc).toHaveBeenCalledWith('pr_task_locks/pbuchman_intexuraos_42');
      expect(mockLockDeleteFn).toHaveBeenCalled();
    });

    it('does NOT delete PR task lock on TTL expiry (non-PR task)', async () => {
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
      const task = createMockTask({
        queuedAt: Timestamp.fromDate(thirtyOneMinutesAgo),
      });
      mockCodeTaskRepo.findOldestQueued.mockResolvedValue(ok(task));
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'expired', taskId: 'task-123' });
      }
      // Verify lock deletion was NOT called (no prNumber on task)
      expect(mockLockDeleteFn).not.toHaveBeenCalled();
    });
  });
});
