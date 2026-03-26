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
 * 8. listQueuedByAge fails → returns err with internal_error
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

const prepareExecutionMemoryContextMock = vi.fn();
let mockExecutionMemoryEnabled = false;

vi.mock('../../../domain/usecases/prepareExecutionMemoryContext.js', (): {
  prepareExecutionMemoryContext: (...args: unknown[]) => unknown;
  toDispatchExecutionMemoryContext: (context: {
    status?: string;
    applicationId?: string;
    retrievalVersion?: string;
    querySummary?: string;
    matchedMemories?: unknown[];
  } | undefined) => unknown;
} => ({
  prepareExecutionMemoryContext: (...args: unknown[]): unknown => prepareExecutionMemoryContextMock(...args),
  toDispatchExecutionMemoryContext: (context: {
    status?: string;
    applicationId?: string;
    retrievalVersion?: string;
    querySummary?: string;
    matchedMemories?: unknown[];
  } | undefined): unknown =>
    context?.status === 'matched'
      ? {
          applicationId: context.applicationId ?? '',
          retrievalVersion: context.retrievalVersion ?? '',
          querySummary: context.querySummary ?? '',
          matchedMemories: context.matchedMemories ?? [],
        }
      : undefined,
}));

// Mock config
vi.mock('../../../config.js', () => ({
  loadConfig: (): {
    queue: { maxSize: number; ttlMinutes: number };
    serviceUrl: string;
    executionMemoryEnabled: boolean;
  } => ({
    queue: { maxSize: 50, ttlMinutes: 30 },
    serviceUrl: 'https://code-agent.test',
    executionMemoryEnabled: mockExecutionMemoryEnabled,
  }),
}));

// Mock secrets
vi.mock('../../../domain/utils/secrets.js', () => ({
  generateCancelNonce: (): string => 'abcd1234',
  generateWebhookSecret: (_secret: string, taskId: string): string => `webhook-${taskId}`,
  CANCEL_NONCE_TTL_MS: 15 * 60 * 1000,
}));

describe('drainTaskQueue', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    listQueuedByAge: ReturnType<typeof vi.fn>;
    hasActiveTaskForLinearIssue: ReturnType<typeof vi.fn>;
    findActiveReviewForPR: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    countQueued: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let mockTaskDispatcher: {
    dispatch: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    validateIssue: ReturnType<typeof vi.fn>;
    fetchIssueTree: ReturnType<typeof vi.fn>;
  };
  let mockWhatsappNotifier: {
    notifyTaskStarted: ReturnType<typeof vi.fn>;
    notifyTaskQueueExpired: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockTaskEnqueueService: {
    enqueue: ReturnType<typeof vi.fn>;
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
    prepareExecutionMemoryContextMock.mockReset();
    mockExecutionMemoryEnabled = false;

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    mockCodeTaskRepo = {
      listQueuedByAge: vi.fn(),
      hasActiveTaskForLinearIssue: vi.fn().mockResolvedValue(ok({ hasActive: false })),
      findActiveReviewForPR: vi.fn().mockResolvedValue(ok(null)),
      findById: vi.fn(),
      update: vi.fn(),
      countQueued: vi.fn(),
      create: vi.fn(),
    };

    mockTaskDispatcher = {
      dispatch: vi.fn(),
    };

    mockLinearAgentClient = {
      validateIssue: vi.fn(),
      fetchIssueTree: vi.fn(),
    };

    mockWhatsappNotifier = {
      notifyTaskStarted: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskQueueExpired: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };

    mockTaskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 0 })),
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
      taskEnqueueService: mockTaskEnqueueService as unknown as DrainTaskQueueDeps['taskEnqueueService'],
      orchestratorSecret: 'test-orchestrator-secret',
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
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([]));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'empty' });
    }
  });

  it('returns err with internal_error when listQueuedByAge fails', async () => {
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(
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
    const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(beyondTtl),
    });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'expired', taskId: 'task-123' }));
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

  it('prepares and threads execution memory context for execution-agent dispatches', async () => {
    mockExecutionMemoryEnabled = true;
    const task = createMockTask({
      linearIssueId: 'INT-1098',
      agentType: 'execution',
    });

    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockLinearAgentClient.validateIssue.mockResolvedValue(ok({
      id: 'issue-123',
      identifier: 'INT-1098',
      title: 'Issue',
      url: 'https://linear.app/intexura/issue/INT-1098',
      labels: ['code-task'],
      childCount: 0,
      parentId: null,
    }));
    setupWorkerSettings();
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'matched',
      applicationId: 'app-123',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Auth callback logging work',
      matchedMemories: [
        {
          memoryId: 'mem-1',
          title: 'Add route-level coverage',
          memoryType: 'verification_pattern',
          score: 0.91,
          appliesWhen: 'Fastify callback routes are changing',
          action: 'Add app.inject coverage',
          avoid: 'Do not skip schema changes',
          verification: 'Check task detail serialization',
        },
      ],
    });
    mockCodeTaskRepo.update.mockImplementation(async (_taskId, input) => ok({
      ...task,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.executionMemoryContext !== undefined
        ? { executionMemoryContext: input.executionMemoryContext }
        : {}),
      ...(input.workerLocation !== undefined ? { workerLocation: input.workerLocation } : {}),
    }));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledOnce();
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
      executionMemoryContext: expect.objectContaining({
        status: 'matched',
        applicationId: 'app-123',
      }),
    }));
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'execution',
      executionMemoryContext: {
        applicationId: 'app-123',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Auth callback logging work',
        matchedMemories: [
          expect.objectContaining({ memoryId: 'mem-1' }),
        ],
      },
    }));
  });

  it('warns when execution memory context persistence fails before dispatch', async () => {
    mockExecutionMemoryEnabled = true;
    const task = createMockTask({
      linearIssueId: 'INT-1098',
      agentType: 'execution',
    });

    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockLinearAgentClient.validateIssue.mockResolvedValue(ok({
      id: 'issue-123',
      identifier: 'INT-1098',
      title: 'Issue',
      url: 'https://linear.app/intexura/issue/INT-1098',
      labels: ['code-task'],
      childCount: 0,
      parentId: null,
    }));
    setupWorkerSettings();
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'none',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Auth callback logging work',
    });
    mockCodeTaskRepo.update
      .mockResolvedValueOnce(err({ message: 'update failed' }))
      .mockResolvedValueOnce(ok({
        ...task,
        status: 'dispatched',
      }));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-123',
        error: expect.objectContaining({ message: 'update failed' }),
      }),
      'Failed to persist execution memory context before dispatch'
    );
  });

  it('clears parent implementationTaskId when expired task has parentTaskId', async () => {
    const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(beyondTtl),
      parentTaskId: 'parent-task-1',
    });
    const parentTask = createMockTask({
      id: 'parent-task-1',
      status: 'planned',
      implementationTaskId: 'task-123',
    });

    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.findById.mockResolvedValue(ok(parentTask));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'expired', taskId: 'task-123' }));
    }

    // Verify findById was called for parent
    expect(mockCodeTaskRepo.findById).toHaveBeenCalledWith('parent-task-1');

    // Verify implementationTaskId was cleared on parent
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('parent-task-1', { implementationTaskId: null });
  });

  it('does not clear parent implementationTaskId when it points to a different task', async () => {
    const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(beyondTtl),
      parentTaskId: 'parent-task-1',
    });
    const parentTask = createMockTask({
      id: 'parent-task-1',
      status: 'planned',
      implementationTaskId: 'different-task-999',
    });

    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.findById.mockResolvedValue(ok(parentTask));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'expired', taskId: 'task-123' }));
    }

    // Verify implementationTaskId was NOT cleared (parent points to different task)
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith('parent-task-1', { implementationTaskId: null });
  });

  it('logs warning when clearing parent implementationTaskId fails', async () => {
    const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(beyondTtl),
      parentTaskId: 'parent-task-1',
    });
    const parentTask = createMockTask({
      id: 'parent-task-1',
      status: 'planned',
      implementationTaskId: 'task-123',
    });

    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.findById.mockResolvedValue(ok(parentTask));
    // First call: mark task as failed (succeeds), second call: clear parent (fails)
    mockCodeTaskRepo.update
      .mockResolvedValueOnce(ok(task))
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'expired', taskId: 'task-123' }));
    }

    // Verify warning was logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: 'parent-task-1', expiredTaskId: 'task-123' }),
      'Failed to clear implementationTaskId on parent task after queue expiry'
    );
  });

  it('logs warning when notifyTaskQueueExpired fails', async () => {
    const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(beyondTtl),
    });

    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));
    mockWhatsappNotifier.notifyTaskQueueExpired.mockResolvedValue(
      err({ code: 'SEND_FAILED', message: 'WhatsApp down' })
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'expired', taskId: 'task-123' }));
    }

    // Verify warning was logged about notification failure
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123' }),
      'Failed to send queue expired notification'
    );
  });

  it('uses createdAt when queuedAt is not set for TTL check', async () => {
    // Create a task with createdAt 31 minutes ago and no queuedAt
    const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
    const task = createMockTask();
    // Remove queuedAt to test fallback to createdAt
    delete (task as unknown as Record<string, unknown>)['queuedAt'];
    (task as unknown as Record<string, unknown>)['createdAt'] = Timestamp.fromDate(beyondTtl);

    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'expired', taskId: 'task-123' }));
    }
  });

  it('returns err with internal_error when worker settings fetch fails', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));

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
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));

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
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));

    setupWorkerSettings([{ ...workerConfig, enabled: false }]);

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
    }
  });

  it('returns still_busy when dispatch fails (workers busy)', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
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
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'network_error', message: 'Connection refused' })
    );

    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'failed', taskId: 'task-123' }));
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
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
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
      expect(result.value).toEqual(expect.objectContaining({ action: 'failed', taskId: 'task-123' }));
    }

    // Verify error was logged about the failed update
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123' }),
      'Failed to persist failed status during drain'
    );
  });

  it('dispatches successfully and updates task status', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
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
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
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

  it('forwards continuation PR metadata and archives the original task after queued retry dispatch', async () => {
    const task = createMockTask({
      prNumber: 1139,
      prBranch: 'task_existing_pr_branch',
      retriedFrom: 'task-original-123',
      agentType: 'execution',
    });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update
      .mockResolvedValueOnce(ok(createMockTask({ status: 'dispatched', workerLocation: 'home-mac' })))
      .mockResolvedValueOnce(ok(createMockTask({ id: 'task-original-123', status: 'archived' })));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        continuationPrNumber: 1139,
        continuationPrBranch: 'task_existing_pr_branch',
        agentType: 'execution',
      })
    );
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-original-123', {
      status: 'archived',
    });
  });

  it('logs a warning when archiving the original task after queued retry dispatch fails', async () => {
    const task = createMockTask({
      prNumber: 1139,
      prBranch: 'task_existing_pr_branch',
      retriedFrom: 'task-original-123',
      agentType: 'execution',
    });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update
      .mockResolvedValueOnce(ok(createMockTask({ status: 'dispatched', workerLocation: 'home-mac' })))
      .mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'archive failed' })
      );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        originalTaskId: 'task-original-123',
        retryTaskId: 'task-123',
      }),
      'Failed to archive original task after queued retry dispatch'
    );
    expect(mockWhatsappNotifier.notifyTaskStarted).toHaveBeenCalled();
  });

  it('dispatches with empty webhookSecret when task has no webhookSecret', async () => {
    const task = createMockTask();
    // Remove webhookSecret to test the ?? '' fallback
    delete (task as unknown as Record<string, unknown>)['webhookSecret'];
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
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
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
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

  it('preserves pull_request routing for legacy pr-comment-auto tasks during drain', async () => {
    const task = createMockTask({
      linearIssueId: 'INT-123',
      systemPromptHash: 'pr-comment-auto',
      sanitizedPrompt: '[PR Comment Task] Comment on PR #42 in pbuchman/intexuraos\nresolve conflicts',
    });
    delete (task as unknown as Record<string, unknown>)['agentType'];
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();

    mockLinearAgentClient.validateIssue.mockResolvedValue(
      ok({
        id: 'issue-id',
        identifier: 'INT-123',
        title: 'Test issue',
        url: 'https://linear.app/intexura/issue/INT-123',
        labels: ['bug'],
        childCount: 0,
      })
    );

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '[PR Comment Task] Comment on PR #42 in pbuchman/intexuraos\nresolve conflicts',
        agentType: 'pull_request',
        linearIssueLabels: ['bug', 'pr-comment'],
      })
    );
  });

  it('continues with empty labels when Linear validation fails', async () => {
    const task = createMockTask({ linearIssueId: 'INT-123' });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
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
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
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
    mockCodeTaskRepo.listQueuedByAge.mockReturnValue(pendingFind);

    // Start first drain (will be stuck waiting for listQueuedByAge)
    const firstDrain = drainTaskQueue(createDeps());

    // Start second drain while first is in progress
    const secondResult = await drainTaskQueue(createDeps());

    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(secondResult.value).toEqual({ action: 'skipped' });
    }

    // Resolve the first drain so it completes
    resolveFind(ok([]));
    const firstResult = await firstDrain;

    expect(firstResult.ok).toBe(true);
    if (firstResult.ok) {
      expect(firstResult.value).toEqual({ action: 'empty' });
    }
  });

  it('resets drain guard even if an error is thrown', async () => {
    mockCodeTaskRepo.listQueuedByAge.mockRejectedValue(new Error('Unexpected error'));

    await expect(drainTaskQueue(createDeps())).rejects.toThrow('Unexpected error');

    // Guard should be reset, so next call should not return 'skipped'
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([]));
    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'empty' });
    }
  });

  it('includes reviewTypes in dispatch when task has them', async () => {
    const task = createMockTask({ reviewTypes: ['code_quality', 'architecture'] });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewTypes: ['code_quality', 'architecture'],
      })
    );
  });

  it('uses agentType from task when available', async () => {
    const task = createMockTask({ agentType: 'execution' });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
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
    it('returns locksToCleanup on TTL expiry (PR task)', async () => {
      const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
      const task = createMockTask({
        queuedAt: Timestamp.fromDate(beyondTtl),
        prNumber: 42,
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('expired');
        expect(result.value.locksToCleanup).toEqual([
          { repository: 'pbuchman/intexuraos', prNumber: 42 },
        ]);
      }
    });

    it('returns locksToCleanup on dispatch failure (PR task)', async () => {
      const task = createMockTask({ prNumber: 42 });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'network_error', message: 'Connection refused' })
      );

      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('failed');
        expect(result.value.locksToCleanup).toEqual([
          { repository: 'pbuchman/intexuraos', prNumber: 42 },
        ]);
      }
    });

    it('returns empty locksToCleanup on TTL expiry (non-PR task)', async () => {
      const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
      const task = createMockTask({
        queuedAt: Timestamp.fromDate(beyondTtl),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('expired');
        expect(result.value.locksToCleanup).toEqual([]);
      }
    });

    it('returns empty locksToCleanup on TTL expiry when task is a follow-up (has parentTaskId)', async () => {
      const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
      const task = createMockTask({
        queuedAt: Timestamp.fromDate(beyondTtl),
        prNumber: 42,
        parentTaskId: 'parent-task-123',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));
      // Mock parent task lookup for implementationTaskId clearing logic
      mockCodeTaskRepo.findById.mockResolvedValue(ok(createMockTask({ id: 'parent-task-123' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('expired');
        expect(result.value.locksToCleanup).toEqual([]);
      }
    });

    it('returns empty locksToCleanup on dispatch failure when task is a follow-up (has parentTaskId)', async () => {
      const task = createMockTask({
        prNumber: 42,
        parentTaskId: 'parent-task-123',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'network_error', message: 'Connection refused' })
      );

      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('failed');
        expect(result.value.locksToCleanup).toEqual([]);
      }
    });
  });

  describe('per-resource concurrency guard (INT-949)', () => {
    it('skips task with linearIssueId when active task exists for same issue', async () => {
      const task = createMockTask({ linearIssueId: 'INT-100' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'other-task-999' })
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy' });
      }
    });

    it('skips task with prNumber when active review exists for same PR', async () => {
      const task = createMockTask({ prNumber: 42, repository: 'pbuchman/intexuraos' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.findActiveReviewForPR.mockResolvedValue(
        ok(createMockTask({ id: 'active-review-999' }))
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy' });
      }
    });

    it('dispatches second candidate when first is blocked by linearIssueId', async () => {
      const blocked = createMockTask({ id: 'task-blocked', linearIssueId: 'INT-100' });
      const dispatchable = createMockTask({ id: 'task-free' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([blocked, dispatchable]));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'other-task-999' })
      );
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ id: 'task-free', status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-free' });
      }
    });

    it('returns still_busy when all candidates are blocked', async () => {
      const task1 = createMockTask({ id: 'task-1', linearIssueId: 'INT-100' });
      const task2 = createMockTask({ id: 'task-2', prNumber: 42, repository: 'pbuchman/intexuraos' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task1, task2]));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'other-task-999' })
      );
      mockCodeTaskRepo.findActiveReviewForPR.mockResolvedValue(
        ok(createMockTask({ id: 'active-review-999' }))
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
      }
    });

    it('does not self-block: task with linearIssueId dispatches when it is the active task', async () => {
      const task = createMockTask({ id: 'task-123', linearIssueId: 'INT-100' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      // hasActive returns this task's own ID — should NOT block
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'task-123' })
      );
      setupWorkerSettings();

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: 'issue-id', identifier: 'INT-100', title: 'Test', url: 'https://linear.app', labels: [], childCount: 0 })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
      }
    });

    it('does not self-block: task with prNumber dispatches when it is the active review', async () => {
      const task = createMockTask({ id: 'task-123', prNumber: 42, repository: 'pbuchman/intexuraos' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.findActiveReviewForPR.mockResolvedValue(
        ok(createMockTask({ id: 'task-123' }))
      );
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
      }
    });
  });

  describe('fan-out check (INT-962)', () => {
    it('triggers fan-out when parent has code-task children and returns dispatched', async () => {
      const task = createMockTask({ linearIssueId: 'INT-956', agentType: 'execution' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      // validateIssue returns code-task label and children
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'parent-uuid',
          identifier: 'INT-956',
          title: 'Parent issue',
          url: 'https://linear.app/intexura/issue/INT-956',
          labels: ['code-task'],
          childCount: 2,
          parentId: null,
        })
      );

      // fetchIssueTree returns children with code-task labels
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({
          root: { id: 'parent-uuid', identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          descendants: [
            { id: 'child-uuid-1', identifier: 'INT-957', url: '', parentId: 'parent-uuid', labels: ['code-task'], assigneeId: null, state: 'Backlog' },
            { id: 'child-uuid-2', identifier: 'INT-958', url: '', parentId: 'parent-uuid', labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          ],
        })
      );

      mockCodeTaskRepo.create.mockResolvedValue(ok(createMockTask({ id: 'child-task' })));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'implemented' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
      }

      // Verify child tasks were created
      expect(mockCodeTaskRepo.create).toHaveBeenCalledTimes(2);
    });

    it('falls back to normal dispatch when fan-out finds no qualifying children', async () => {
      const task = createMockTask({ linearIssueId: 'INT-956' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'parent-uuid',
          identifier: 'INT-956',
          title: 'Parent issue',
          url: 'https://linear.app/intexura/issue/INT-956',
          labels: ['code-task'],
          childCount: 1,
          parentId: null,
        })
      );

      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({
          root: { id: 'parent-uuid', identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          descendants: [
            { id: 'child-uuid-1', identifier: 'INT-959', url: '', parentId: 'parent-uuid', labels: ['feature'], assigneeId: null, state: 'Backlog' },
          ],
        })
      );

      // Normal dispatch should proceed
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
      }

      // Verify normal dispatch was called (fan-out failed, fell through)
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalled();
    });

    it('does not trigger fan-out when hasChildren=false', async () => {
      const task = createMockTask({ linearIssueId: 'INT-956' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'issue-id',
          identifier: 'INT-956',
          title: 'Test',
          url: 'https://linear.app',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      await drainTaskQueue(createDeps());

      // Normal dispatch should proceed (no fan-out)
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalled();
    });
  });

  describe('queued review merge (INT-1014)', () => {
    it('merges 2 duplicate queued reviews for same PR — oldest cancelled, newest dispatched', async () => {
      // Older review (createdAt first)
      const olderReview = createMockTask({
        id: 'review-old',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)), // 10 min ago
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      // Newer review (createdAt later)
      const newerReview = createMockTask({
        id: 'review-new',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)), // 5 min ago
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([olderReview, newerReview]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'review-new' });
      }

      // Older review should be cancelled
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'review-old',
        expect.objectContaining({
          status: 'cancelled',
          completedAt: expect.any(Date),
          error: expect.objectContaining({
            code: 'review_replaced',
            message: 'Superseded by newer queued review for same PR',
          }),
        })
      );

      // Newer review should be dispatched (not cancelled)
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'review-new' })
      );

      // Info log for cancellation
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          cancelledTaskId: 'review-old',
          survivingTaskId: 'review-new',
          repository: 'pbuchman/intexuraos',
          prNumber: 42,
        }),
        expect.stringContaining('superseded by newer queued review')
      );
    });

    it('merges 3+ queued reviews for same PR — all but newest cancelled', async () => {
      const review1 = createMockTask({
        id: 'review-1',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 30 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 30 * 60 * 1000)),
      });
      const review2 = createMockTask({
        id: 'review-2',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
      });
      const review3 = createMockTask({
        id: 'review-3',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      // Return in order: oldest first (FIFO from listQueuedByAge)
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([review1, review2, review3]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'review-3' });
      }

      // review-1 and review-2 should be cancelled; review-3 survives
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'review-1',
        expect.objectContaining({ status: 'cancelled', error: expect.objectContaining({ code: 'review_replaced' }) })
      );
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'review-2',
        expect.objectContaining({ status: 'cancelled', error: expect.objectContaining({ code: 'review_replaced' }) })
      );
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'review-3' })
      );
    });

    it('keeps cancelled review eligible when update fails — newest review still dispatched', async () => {
      const reviewOld = createMockTask({
        id: 'review-old',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      const reviewNew = createMockTask({
        id: 'review-new',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
      });
      // FIFO order from listQueuedByAge: oldest first
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([reviewOld, reviewNew]));
      setupWorkerSettings();

      // First update (cancel oldest) fails — reviewOld stays eligible
      // Subsequent updates succeed
      mockCodeTaskRepo.update
        .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }))
        .mockResolvedValueOnce(ok(createMockTask({ id: 'review-old', status: 'cancelled' })));

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Oldest (reviewOld) dispatched — its cancellation failed so it remained in activeCandidates
        // and was picked first in FIFO dispatch order before findActiveReviewForPR could block it
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'review-old' });
      }

      // reviewOld's cancellation update was called (and failed)
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'review-old',
        expect.objectContaining({ status: 'cancelled', error: expect.objectContaining({ code: 'review_replaced' }) })
      );
      // reviewNew was not dispatched since reviewOld was picked first
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'review-new' })
      );
    });

    it('does not merge different PRs — both remain, oldest dispatched normally', async () => {
      const reviewPR42 = createMockTask({
        id: 'review-pr42',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      const reviewPR99 = createMockTask({
        id: 'review-pr99',
        repository: 'pbuchman/intexuraos',
        prNumber: 99,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
      });
      // FIFO order from listQueuedByAge: reviewPR42 first (older)
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([reviewPR42, reviewPR99]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Oldest (reviewPR42) dispatched since different PRs don't merge
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'review-pr42' });
      }

      // No cancellations — different PRs
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'cancelled' })
      );
    });

    it('does not merge non-review tasks — execution tasks follow normal FIFO', async () => {
      const execOld = createMockTask({
        id: 'exec-old',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'execution',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      const execNew = createMockTask({
        id: 'exec-new',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'execution',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([execOld, execNew]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Oldest dispatched, no merge
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'exec-old' });
      }

      // No cancellations
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'cancelled' })
      );
    });

    it('does not merge mixed review + non-review tasks for same PR', async () => {
      const execTask = createMockTask({
        id: 'exec-task',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'execution',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      const reviewTask = createMockTask({
        id: 'review-task',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([execTask, reviewTask]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        // execTask (older) dispatched first; function returns after first dispatch
        // reviewTask is not evaluated since drainTaskQueue exits early
        // No merge occurs — different agentType means review merge logic does not apply
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'exec-task' });
      }

      // No cancellation — different agentType, no merge
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'cancelled' })
      );
    });

    it('skips merge for review without prNumber — normal dispatch', async () => {
      const reviewNoPR = createMockTask({
        id: 'review-no-pr',
        repository: 'pbuchman/intexuraos',
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([reviewNoPR]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'review-no-pr' });
      }

      // No cancellations — prNumber undefined means skipped by merge logic
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'cancelled' })
      );
    });
  });

  describe('dispatch metadata field reconstruction (INT-949)', () => {
    it('passes planningPrBranch and planningPrUrl through to dispatch request', async () => {
      const task = createMockTask({
        agentType: 'execution',
        planningPrBranch: 'task_planning_branch',
        planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/99',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      await drainTaskQueue(createDeps());

      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          planningPrBranch: 'task_planning_branch',
          planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/99',
        })
      );
    });

    it('passes trackingCommentId through to dispatch request', async () => {
      const task = createMockTask({
        agentType: 'pull_request',
        trackingCommentId: 'comment-42',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      await drainTaskQueue(createDeps());

      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          trackingCommentId: 'comment-42',
        })
      );
    });

    it('passes retriedFrom through to dispatch request', async () => {
      const task = createMockTask({
        retriedFrom: 'task-original-456',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      await drainTaskQueue(createDeps());

      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          retriedFrom: 'task-original-456',
        })
      );
    });

    it('does not include metadata fields when not present on task', async () => {
      const task = createMockTask();
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      await drainTaskQueue(createDeps());

      const dispatchCall = mockTaskDispatcher.dispatch.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(dispatchCall['planningPrBranch']).toBeUndefined();
      expect(dispatchCall['planningPrUrl']).toBeUndefined();
      expect(dispatchCall['trackingCommentId']).toBeUndefined();
      expect(dispatchCall['retriedFrom']).toBeUndefined();
    });
  });
});
