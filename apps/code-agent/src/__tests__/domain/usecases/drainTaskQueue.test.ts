/**
 * Tests for drainTaskQueue use case.
 *
 * INT-619: Task queueing when workers are at capacity.
 *
 * Test Requirements:
 * 1. Empty queue → returns { action: 'empty' }
 * 2. TTL expired → marks task failed with queue_timeout, calls notifyTaskDispatchBlocked
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
import type { CodeTaskDispatchStatusService } from '../../../domain/services/codeTaskDispatchStatusService.js';
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
    codeTaskCallbackBaseUrl: string;
    executionMemoryEnabled: boolean;
  } => ({
    queue: { maxSize: 50, ttlMinutes: 1440 },
    serviceUrl: 'https://code-agent.test',
    codeTaskCallbackBaseUrl: 'https://callback.test',
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
    listQueued: ReturnType<typeof vi.fn>;
    hasDispatchedOrRunningForPR: ReturnType<typeof vi.fn>;
    hasOtherDispatchedOrRunningForLinearIssue: ReturnType<typeof vi.fn>;
    claimForDispatch: ReturnType<typeof vi.fn>;
    rollbackDispatch: ReturnType<typeof vi.fn>;
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
    fetchDirectChildrenLive: ReturnType<typeof vi.fn>;
  };
  let mockWhatsappNotifier: {
    notifyTaskStarted: ReturnType<typeof vi.fn>;
    notifyTaskQueueExpired: ReturnType<typeof vi.fn>;
    notifyTaskDispatchBlocked: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockTaskEnqueueService: {
    enqueue: ReturnType<typeof vi.fn>;
  };
  let mockDispatchStatusService: CodeTaskDispatchStatusService;
  let mockUserServiceClient: {
    getLlmClient: ReturnType<typeof vi.fn>;
  };
  const workerConfig = {
    name: 'home-mac',
    url: 'https://worker.local',
    cfAccessClientId: 'client-id',
    cfAccessClientSecret: 'client-secret',
    dispatchSigningSecret: 'signing-secret',
    enabled: true,
  };
  const claimed = (dispatchToken = 'test-dispatch-token'): {
    kind: 'claimed';
    dispatchToken: string;
  } => ({ kind: 'claimed', dispatchToken });

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
      listQueued: vi.fn().mockResolvedValue(ok([])),
      hasDispatchedOrRunningForPR: vi.fn().mockResolvedValue(ok({ hasActive: false })),
      hasOtherDispatchedOrRunningForLinearIssue: vi.fn().mockResolvedValue(ok({ hasActive: false })),
      claimForDispatch: vi.fn().mockResolvedValue(ok(claimed('dispatch-token'))),
      rollbackDispatch: vi.fn().mockResolvedValue(ok(true)),
      findById: vi.fn(),
      update: vi.fn().mockResolvedValue(ok(createMockTask())),
      countQueued: vi.fn(),
      create: vi.fn(),
    };

    mockTaskDispatcher = {
      dispatch: vi.fn(),
    };

    mockLinearAgentClient = {
      validateIssue: vi.fn(),
      fetchIssueTree: vi.fn(),
      fetchDirectChildrenLive: vi.fn(),
    };

    mockWhatsappNotifier = {
      notifyTaskStarted: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskQueueExpired: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };

    mockTaskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 0 })),
    };

    mockDispatchStatusService = {
      recordDispatchBlocked: vi.fn().mockResolvedValue(undefined),
      resolveDispatchBlockers: vi.fn().mockResolvedValue(undefined),
    };

    mockUserServiceClient = {
      getLlmClient: vi.fn().mockResolvedValue(ok({ generate: vi.fn() })),
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
      codeTaskDispatchStatusService: mockDispatchStatusService,
      userServiceClient: mockUserServiceClient as never,
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
    // Create a task queued 1441 minutes ago (TTL is 1440 minutes)
    const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
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
        message: 'Task expired in queue after 1440 minutes before a worker could start.',
      },
      dispatchStatus: expect.objectContaining({
        state: 'terminal',
        reason: 'queue_timeout',
        terminal: true,
        nextAction: 'retry_after_fix',
      }),
    });

    // Verify dispatch-blocked notification sent and recorded
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      reason: 'queue_timeout',
      exampleTaskId: 'task-123',
    }));
    expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-456',
      workerType: 'auto',
      observedBefore: expect.any(Date),
    }));
  });

  it('returns internal_error and does not notify when queue timeout failure cannot be persisted', async () => {
    const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(beyondTtl),
    });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'internal_error',
      message: 'Failed to persist queue timeout status',
    });
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
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

  it('prepares execution memory context for planning agent when enabled', async () => {
    mockExecutionMemoryEnabled = true;
    const task = createMockTask({
      linearIssueId: 'INT-1098',
      agentType: 'planning',
    });

    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockLinearAgentClient.validateIssue.mockResolvedValue(ok({
      id: 'issue-123',
      identifier: 'INT-1098',
      title: 'Issue',
      url: 'https://linear.app/intexura/issue/INT-1098',
      labels: ['plan'],
      childCount: 0,
      parentId: null,
    }));
    setupWorkerSettings();
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'matched',
      applicationId: 'app-planning-123',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Planning the auth callback feature',
      matchedMemories: [
        {
          memoryId: 'mem-plan-1',
          title: 'Add route-level coverage',
          memoryType: 'verification_pattern',
          score: 0.85,
          appliesWhen: 'Planning Fastify route changes',
          action: 'Include coverage plan in output',
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
        applicationId: 'app-planning-123',
      }),
    }));
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'planning',
      executionMemoryContext: {
        applicationId: 'app-planning-123',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Planning the auth callback feature',
        matchedMemories: [
          expect.objectContaining({ memoryId: 'mem-plan-1' }),
        ],
      },
    }));
  });

  it('prepares execution memory context for review agent when enabled', async () => {
    mockExecutionMemoryEnabled = true;
    const task = createMockTask({
      linearIssueId: 'INT-1098',
      agentType: 'review',
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
      applicationId: 'app-review-123',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Reviewing the auth callback feature',
      matchedMemories: [
        {
          memoryId: 'mem-review-1',
          title: 'Check route schema coverage',
          memoryType: 'verification_pattern',
          score: 0.87,
          appliesWhen: 'Reviewing Fastify route changes',
          action: 'Verify schema and handler coverage',
          avoid: 'Do not skip inline comments',
          verification: 'Check route response shape',
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
        applicationId: 'app-review-123',
      }),
    }));
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'review',
      executionMemoryContext: {
        applicationId: 'app-review-123',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Reviewing the auth callback feature',
        matchedMemories: [
          expect.objectContaining({ memoryId: 'mem-review-1' }),
        ],
      },
    }));
  });

  it('prepares execution memory for pull_request agent', async () => {
    mockExecutionMemoryEnabled = true;
    const task = createMockTask({
      linearIssueId: 'INT-1098',
      agentType: 'pull_request',
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
      status: 'no_memories',
      applicationId: 'app-pr-1',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'PR review task',
      matchedMemories: [],
    });
    mockCodeTaskRepo.update.mockResolvedValue(ok({ ...task, status: 'dispatched' }));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledOnce();
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

  it('logs warning when execution memory retrieval returns error status and still dispatches', async () => {
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
      status: 'error',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Auth callback logging work',
      errorCode: 'embedding_failed',
      errorMessage: 'API timeout',
    });
    mockCodeTaskRepo.update.mockResolvedValue(ok({
      ...task,
      status: 'dispatched',
    }));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-123',
        errorCode: 'embedding_failed',
        errorMessage: 'API timeout',
      }),
      'Execution memory retrieval returned error status'
    );
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledOnce();
  });

  it('falls back to no query client when userServiceClient is not provided', async () => {
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
      status: 'no_match',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'test query',
    });
    mockCodeTaskRepo.update.mockResolvedValue(ok({ ...task, status: 'dispatched' }));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const deps = createDeps();
    delete (deps as Partial<typeof deps>).userServiceClient;
    const result = await drainTaskQueue(deps);

    expect(result.ok).toBe(true);
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ queryClient: undefined }),
    );
  });

  it('warns and falls back when getLlmClient fails for execution memory', async () => {
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
    mockUserServiceClient.getLlmClient.mockResolvedValue(err({ code: 'not_found', message: 'User not found' }));
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'no_match',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'test query',
    });
    mockCodeTaskRepo.update.mockResolvedValue(ok({ ...task, status: 'dispatched' }));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-456' }),
      'Failed to resolve user LLM client for execution memory',
    );
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ queryClient: undefined }),
    );
  });

  it('clears parent implementationTaskId when expired task has parentTaskId', async () => {
    const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
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
    const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
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
    const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
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

  it('logs warning when queue timeout dispatch notification fails', async () => {
    const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
    const task = createMockTask({
      queuedAt: Timestamp.fromDate(beyondTtl),
    });

    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));
    mockWhatsappNotifier.notifyTaskDispatchBlocked.mockResolvedValue(
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
      'Failed to notify user about code task dispatch blocker'
    );
  });

  it('uses createdAt when queuedAt is not set for TTL check', async () => {
    // Create a task with createdAt 31 minutes ago and no queuedAt
    const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
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

  it('fails immediately when worker settings returns null', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(null));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'failed', taskId: 'task-123' }));
    }
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({
        code: 'dispatch_blocked_no_enabled_workers',
      }),
      dispatchStatus: expect.objectContaining({
        state: 'terminal',
        reason: 'no_enabled_workers',
      }),
    }));
  });

  it('fails immediately when user has no enabled workers', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    setupWorkerSettings([{ ...workerConfig, enabled: false }]);

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'failed', taskId: 'task-123' }));
    }
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({
        code: 'dispatch_blocked_no_enabled_workers',
        remediation: expect.objectContaining({
          action: 'retry',
          manualSteps: expect.stringContaining('Enable or add a worker'),
        }),
      }),
      dispatchStatus: expect.objectContaining({
        state: 'terminal',
        reason: 'no_enabled_workers',
        terminal: true,
        nextAction: 'retry_after_fix',
      }),
    }));
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      workerType: 'auto',
      reason: 'no_enabled_workers',
      affectedTaskCount: 1,
      exampleTaskId: 'task-123',
    }));
    expect(mockCodeTaskRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockWhatsappNotifier.notifyTaskDispatchBlocked.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('fails all queued tasks affected by a terminal no-worker blocker', async () => {
    const task1 = createMockTask({ id: 'task-1', workerType: 'opus' });
    const task2 = createMockTask({ id: 'task-2', workerType: 'opus' });
    const unaffected = createMockTask({ id: 'task-3', workerType: 'sonnet' });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task1, task2, unaffected]));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task1));
    setupWorkerSettings([{ ...workerConfig, enabled: false }]);

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-1', expect.objectContaining({
      status: 'failed',
      dispatchStatus: expect.objectContaining({ reason: 'no_enabled_workers' }),
    }));
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-2', expect.objectContaining({
      status: 'failed',
      dispatchStatus: expect.objectContaining({ reason: 'no_enabled_workers' }),
    }));
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith('task-3', expect.anything());
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      reason: 'no_enabled_workers',
      affectedTaskCount: 2,
      exampleTaskId: 'task-1',
    }));
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      reason: 'no_enabled_workers',
      affectedTaskCount: 2,
      exampleTaskId: 'task-2',
    }));
  });

  it('records a dispatch system status when user has no enabled workers', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));
    setupWorkerSettings([{ ...workerConfig, enabled: false }]);

    await drainTaskQueue(createDeps());

    expect(mockDispatchStatusService.recordDispatchBlocked).toHaveBeenCalledWith({
      userId: 'user-456',
      workerType: 'auto',
      blocker: expect.objectContaining({
        dispatchable: false,
        reason: 'no_enabled_workers',
      }),
      affectedTaskCount: 1,
      exampleTaskIds: ['task-123'],
    });
    expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-456',
      workerType: 'auto',
      observedBefore: expect.any(Date),
    }));
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-456',
        taskId: 'task-123',
        reason: 'no_enabled_workers',
        _skipSentry: true,
      }),
      'Drain blocked: user has no enabled workers — task failed immediately',
    );
  });

  it('still fails and notifies when no enabled workers exist and dispatch status service is omitted', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));
    setupWorkerSettings([{ ...workerConfig, enabled: false }]);
    const deps = createDeps();
    delete (deps as Partial<DrainTaskQueueDeps>).codeTaskDispatchStatusService;

    const result = await drainTaskQueue(deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'failed', taskId: 'task-123' }));
    }
    expect(mockDispatchStatusService.recordDispatchBlocked).not.toHaveBeenCalled();
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      reason: 'no_enabled_workers',
      exampleTaskId: 'task-123',
    }));
  });

  it('does not notify or fail no-worker task when another drain already claimed it', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok({ kind: 'task_not_queued' }));
    setupWorkerSettings([{ ...workerConfig, enabled: false }]);

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
    }
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
    expect(mockDispatchStatusService.recordDispatchBlocked).not.toHaveBeenCalled();
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('does not notify or fail no-worker task when dispatch claim fails', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'transaction aborted' }),
    );
    setupWorkerSettings([{ ...workerConfig, enabled: false }]);

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
    }
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
    expect(mockDispatchStatusService.recordDispatchBlocked).not.toHaveBeenCalled();
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('returns internal_error when no-worker task failure cannot be persisted', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
    );
    setupWorkerSettings([{ ...workerConfig, enabled: false }]);

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'internal_error',
      message: 'Failed to persist dispatch failure status',
    });
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('returns still_busy when dispatch fails (workers busy)', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'at_capacity', message: 'All workers busy' })
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
    }
  });

  it('records dispatch system status when dispatcher returns blocker metadata', async () => {
    const task = createMockTask({ workerType: 'codex-xhigh' });
    const blocker = {
      dispatchable: false as const,
      reason: 'codex_auth_unavailable' as const,
      severity: 'critical' as const,
      message: 'No reachable worker has active Codex auth for codex-xhigh.',
      remediation: 'Refresh Codex/ChatGPT authentication on a worker that can run this task.',
      workerNames: ['home-mac'],
    };
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));
    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'worker_unavailable', message: blocker.message, blocker })
    );

    await drainTaskQueue(createDeps());

    expect(mockDispatchStatusService.recordDispatchBlocked).toHaveBeenCalledWith({
      userId: 'user-456',
      workerType: 'codex-xhigh',
      blocker,
      affectedTaskCount: 1,
      exampleTaskIds: ['task-123'],
    });
    expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-456',
      workerType: 'codex-xhigh',
      observedBefore: expect.any(Date),
    }));
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-123',
        workerType: 'codex-xhigh',
        reason: 'codex_auth_unavailable',
        terminal: true,
        _skipSentry: true,
      }),
      'Drain dispatch blocked by known worker capability state',
    );
  });

  it('records task-level waiting status and sends one notification for recoverable dispatcher blockers', async () => {
    const task = createMockTask({ workerType: 'codex-xhigh' });
    const blocker = {
      dispatchable: false as const,
      reason: 'workers_at_capacity' as const,
      severity: 'warning' as const,
      message: 'All capable workers for codex-xhigh are currently at capacity.',
      remediation: 'Wait for a running task to finish or add worker capacity.',
      workerNames: ['home-mac'],
    };
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));
    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'at_capacity', message: blocker.message, blocker })
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
    }
    expect(mockCodeTaskRepo.rollbackDispatch).toHaveBeenCalledWith(
      'task-123',
      'test-dispatch-token',
      expect.objectContaining({
        state: 'waiting',
        reason: 'workers_at_capacity',
        terminal: false,
        nextAction: 'will_retry_automatically',
      }),
    );
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      workerType: 'codex-xhigh',
      reason: 'workers_at_capacity',
      affectedTaskCount: 1,
      exampleTaskId: 'task-123',
    }));
    expect(mockCodeTaskRepo.rollbackDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      (mockDispatchStatusService.recordDispatchBlocked as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('marks all queued tasks affected by a recoverable worker blocker as waiting', async () => {
    const task1 = createMockTask({ id: 'task-1', workerType: 'codex-xhigh' });
    const task2 = createMockTask({ id: 'task-2', workerType: 'codex-xhigh' });
    const unaffected = createMockTask({ id: 'task-3', workerType: 'opus' });
    const blocker = {
      dispatchable: false as const,
      reason: 'workers_at_capacity' as const,
      severity: 'warning' as const,
      message: 'All capable workers for codex-xhigh are currently at capacity.',
      remediation: 'Wait for a running task to finish or add worker capacity.',
      workerNames: ['home-mac'],
    };
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task1, task2, unaffected]));
    setupWorkerSettings();
    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'at_capacity', message: blocker.message, blocker }),
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(mockCodeTaskRepo.rollbackDispatch).toHaveBeenCalledWith(
      'task-1',
      'dispatch-token',
      expect.objectContaining({
        reason: 'workers_at_capacity',
      }),
    );
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-2', expect.objectContaining({
      status: 'queued',
      dispatchStatus: expect.objectContaining({ reason: 'workers_at_capacity' }),
    }));
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith('task-3', expect.objectContaining({
      dispatchStatus: expect.objectContaining({ reason: 'workers_at_capacity' }),
    }));
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      reason: 'workers_at_capacity',
      affectedTaskCount: 2,
      exampleTaskId: 'task-1',
    }));
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      reason: 'workers_at_capacity',
      affectedTaskCount: 2,
      exampleTaskId: 'task-2',
    }));
  });

  it('preserves firstSeenAt while updating a repeated dispatch reason', async () => {
    const firstSeenAt = Timestamp.fromDate(new Date('2026-06-05T12:00:00.000Z'));
    const task = {
      ...createMockTask({
      workerType: 'codex-xhigh',
      }),
      dispatchStatus: {
        state: 'waiting',
        reason: 'workers_at_capacity',
        terminal: false,
        severity: 'warning',
        message: 'All capable workers for codex-xhigh are currently at capacity.',
        remediation: 'Wait for a running task to finish or add worker capacity.',
        workerNames: ['home-mac'],
        firstSeenAt,
        lastSeenAt: firstSeenAt,
        nextAction: 'will_retry_automatically',
      },
    } as CodeTask;
    const blocker = {
      dispatchable: false as const,
      reason: 'workers_at_capacity' as const,
      severity: 'warning' as const,
      message: 'All capable workers for codex-xhigh are currently at capacity.',
      remediation: 'Wait for a running task to finish or add worker capacity.',
      workerNames: ['home-mac'],
    };
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
    mockCodeTaskRepo.update.mockResolvedValue(ok(task));
    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'at_capacity', message: blocker.message, blocker })
    );

    await drainTaskQueue(createDeps());

    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      reason: 'workers_at_capacity',
      exampleTaskId: 'task-123',
    }));
    expect(mockCodeTaskRepo.rollbackDispatch).toHaveBeenCalledWith(
      'task-123',
      'test-dispatch-token',
      expect.objectContaining({
        reason: 'workers_at_capacity',
        firstSeenAt,
      }),
    );
  });

  it('fails task when dispatch returns permanent error', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));

    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'dispatch_failed', message: 'Bad worker response' })
    );

    mockCodeTaskRepo.update.mockResolvedValue(ok(task));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({ action: 'failed', taskId: 'task-123' }));
    }

    // Verify task was marked as failed with the dispatch error
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
      status: 'failed',
      error: {
        code: 'dispatch_blocked_dispatch_failed',
        message: expect.stringContaining('Bad worker response'),
        remediation: expect.objectContaining({
          action: 'retry',
        }),
      },
      dispatchStatus: expect.objectContaining({
        state: 'terminal',
        reason: 'dispatch_failed',
        terminal: true,
        nextAction: 'retry_after_fix',
      }),
    }));
  });

  it('returns internal_error when fail-status update itself fails during permanent dispatch error', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));

    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'dispatch_failed', message: 'Bad worker response' })
    );

    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'Firestore write failed' })
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to persist dispatch failure status',
      });
    }

    // Verify error was logged about the failed update
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123' }),
      'Failed to persist failed status during dispatch blocker handling'
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

    // Verify task updated with cancel nonce, worker location, and initial lastHeartbeat
    // (so findZombieTasks can catch tasks that fail before the first real heartbeat).
    // Status/dispatchedAt are no longer in this update — claimForDispatch already set them
    // atomically before the network dispatch (Fix E).
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', {
      lastHeartbeat: expect.any(Date),
      workerLocation: 'home-mac',
      cancelNonce: 'abcd1234',
      cancelNonceExpiresAt: expect.any(String),
      dispatchStatus: null,
      callbackState: expect.objectContaining({
        webhookUrl: 'https://callback.test/internal/webhooks/task-complete',
        callbackBaseUrl: 'https://callback.test',
        owner: 'custom',
        configuredAt: expect.any(Date),
      }),
    });

    // Verify notification sent
    expect(mockWhatsappNotifier.notifyTaskStarted).toHaveBeenCalledWith('user-456', updatedTask);
    expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-456',
      workerType: 'auto',
      observedBefore: expect.any(Date),
    }));
  });

  it('preserves the aggregate when another matching queued task is still blocked', async () => {
    const task = createMockTask();
    const otherBlockedTask = createMockTask({
      id: 'task-other',
      dispatchStatus: {
        state: 'waiting',
        reason: 'workers_at_capacity',
        severity: 'warning',
        message: 'All capable workers are currently at capacity.',
        remediation: 'Wait for capacity.',
        workerNames: ['home-mac'],
        firstSeenAt: Timestamp.now(),
        lastSeenAt: Timestamp.now(),
        nextAction: 'will_retry_automatically',
        terminal: false,
        notifiedReasons: {},
      },
    });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.listQueued.mockResolvedValue(ok([otherBlockedTask]));
    setupWorkerSettings();
    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(
      ok(createMockTask({ status: 'dispatched', workerLocation: 'home-mac' }))
    );

    await drainTaskQueue(createDeps());

    expect(mockDispatchStatusService.resolveDispatchBlockers).not.toHaveBeenCalled();
  });

  it('preserves the aggregate when the queue reconciliation read fails', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.listQueued.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'queue read failed' })
    );
    setupWorkerSettings();
    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(
      ok(createMockTask({ status: 'dispatched', workerLocation: 'home-mac' }))
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(mockDispatchStatusService.resolveDispatchBlockers).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-123',
        workerType: 'auto',
        error: { code: 'FIRESTORE_ERROR', message: 'queue read failed' },
      }),
      'Failed to reconcile queued tasks before resolving dispatch blockers'
    );
  });

  it('captures the aggregate-resolution cutoff before re-reading the queue', async () => {
    vi.useFakeTimers();
    const observedBefore = new Date('2026-07-27T12:00:00.000Z');
    vi.setSystemTime(observedBefore);
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    mockCodeTaskRepo.listQueued.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-07-27T12:00:01.000Z'));
      return ok([]);
    });
    setupWorkerSettings();
    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(
      ok(createMockTask({ status: 'dispatched', workerLocation: 'home-mac' }))
    );

    await drainTaskQueue(createDeps());

    expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith({
      userId: 'user-456',
      workerType: 'auto',
      observedBefore,
    });
  });

  it('dispatches successfully when dispatch status service is omitted', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched', workerLocation: 'home-mac' })));
    const deps = createDeps();
    delete (deps as Partial<DrainTaskQueueDeps>).codeTaskDispatchStatusService;

    const result = await drainTaskQueue(deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
    }
    expect(mockDispatchStatusService.resolveDispatchBlockers).not.toHaveBeenCalled();
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
      dispatchAttemptId: 'dispatch-token',
      prompt: 'Fix the bug',
      systemPromptHash: 'hash-abc',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      workerType: 'auto',
      webhookUrl: 'https://callback.test/internal/webhooks/task-complete',
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
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
      callbackState: expect.objectContaining({
        webhookUrl: 'https://callback.test/internal/webhooks/task-complete',
        callbackBaseUrl: 'https://callback.test',
        owner: 'custom',
      }),
    }));
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

  it('forwards prNumber in dispatch request when task has prNumber and prBranch', async () => {
    const task = createMockTask({ prNumber: 42, prBranch: 'fix/review-branch', agentType: 'review' });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 42 })
    );
  });

  it('forwards Sentry issue context in dispatch request for Sentry tasks', async () => {
    const sentryIssue = {
      organizationSlug: 'intexura',
      projectSlug: 'code-agent',
      projectId: '42',
      issueId: '123456',
      issueShortId: 'CODE-AGENT-1',
      issueUrl: 'https://intexura.sentry.io/issues/123456/',
      title: 'TypeError: Cannot read properties of undefined',
      action: 'created',
      receivedAt: '2026-06-28T12:00:00.000Z',
      eventId: 'event-1',
    };
    const task = createMockTask({
      agentType: 'sentry',
      sentryIssue,
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
        agentType: 'sentry',
        sentryIssue,
      })
    );
  });

  it('fails task with dispatch status when review task has prNumber but no prBranch', async () => {
    const task = createMockTask({ prNumber: 42, agentType: 'review' });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'failed' })));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('failed');
      expect(result.value.locksToCleanup).toEqual([
        { repository: 'pbuchman/intexuraos', prNumber: 42 },
      ]);
    }
    expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({
          code: 'dispatch_blocked_missing_pr_branch',
        }),
        dispatchStatus: expect.objectContaining({
          state: 'terminal',
          reason: 'missing_pr_branch',
          nextAction: 'retry_after_fix',
        }),
      })
    );
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', expect.objectContaining({
      reason: 'missing_pr_branch',
      exampleTaskId: task.id,
    }));
  });

  it('returns internal_error when missing PR branch task failure cannot be persisted', async () => {
    const task = createMockTask({ prNumber: 42, agentType: 'review' });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
    );

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'internal_error',
      message: 'Failed to persist dispatch failure status',
    });
    expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('does not include prNumber in dispatch request when task has no prNumber', async () => {
    const task = createMockTask({ agentType: 'planning' });
    delete (task as unknown as Record<string, unknown>)['prNumber'];
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.not.objectContaining({ prNumber: expect.anything() })
    );
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
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueId: 'INT-123',
        error: { code: 'UNAVAILABLE', message: 'Linear down' },
        _skipSentry: true,
      }),
      'Failed to refresh Linear labels during drain'
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

  it('passes failedWorkerLocation through to dispatcher when set on task', async () => {
    const task = createMockTask({ failedWorkerLocation: 'mac-dev-1' });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        failedWorkerLocation: 'mac-dev-1',
      })
    );
  });

  it('omits failedWorkerLocation from dispatch when not set on task', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.not.objectContaining({ failedWorkerLocation: expect.anything() })
    );
  });

  it('forwards timeoutHours to dispatcher when task has it (INT-1585)', async () => {
    const task = createMockTask({ timeoutHours: 8 });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutHours: 8 }),
    );
  });

  it('omits timeoutHours from dispatch when task has none — backward compat (INT-1585)', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();

    mockTaskDispatcher.dispatch.mockResolvedValue(
      ok({ dispatched: true, workerLocation: 'home-mac' })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

    await drainTaskQueue(createDeps());

    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.not.objectContaining({ timeoutHours: expect.anything() }),
    );
  });

  describe('PR task lock cleanup', () => {
    it('returns locksToCleanup on TTL expiry (PR task)', async () => {
      const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
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
      const task = createMockTask({ prNumber: 42, prBranch: 'fix/some-branch' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));

      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'dispatch_failed', message: 'Bad worker response' })
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
      const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
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
      const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
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
        prBranch: 'fix/some-branch',
        parentTaskId: 'parent-task-123',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));

      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'dispatch_failed', message: 'Bad worker response' })
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

  describe('per-PR concurrency guard and round-robin', () => {
    it('skips task when dispatched/running task exists for same PR', async () => {
      const task = createMockTask({ prNumber: 42, repository: 'pbuchman/intexuraos' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockResolvedValue(
        ok({ hasActive: true, taskId: 'running-task-999' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
      }
    });

    it('resets queuedAt when task is skipped due to PR-lock', async () => {
      const task = createMockTask({ prNumber: 42, repository: 'pbuchman/intexuraos' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockResolvedValue(
        ok({ hasActive: true, taskId: 'running-task-999' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
      }

      // Verify queuedAt was reset and the task page can explain the active PR wait.
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
        queuedAt: expect.any(Date),
        dispatchStatus: expect.objectContaining({
          state: 'waiting',
          reason: 'active_task_blocked',
          nextAction: 'wait_for_active_task',
        }),
      }));
    });

    it('logs warning and continues when queuedAt reset fails for PR-locked task', async () => {
      const task = createMockTask({ prNumber: 42, repository: 'pbuchman/intexuraos' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockResolvedValue(
        ok({ hasActive: true, taskId: 'running-task-999' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Write failed' })
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
      }

      // Verify warning was logged about the failed reset
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          error: { code: 'FIRESTORE_ERROR', message: 'Write failed' },
        }),
        'Failed to reset queuedAt for PR-locked task — TTL clock continues from original queuedAt',
      );
    });

    it('does not expire a PR-locked task even when TTL exceeded — resets queuedAt instead', async () => {
      const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
      const task = createMockTask({
        prNumber: 42,
        repository: 'pbuchman/intexuraos',
        queuedAt: Timestamp.fromDate(beyondTtl),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockResolvedValue(
        ok({ hasActive: true, taskId: 'running-task-999' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Task stays in queue (still_busy), NOT expired
        expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
      }

      // Verify queuedAt was reset (NOT marked as failed)
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
        queuedAt: expect.any(Date),
      }));
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith('task-123', expect.objectContaining({
        status: 'failed',
      }));
    });

    it('dispatches next PR task when first PR is blocked', async () => {
      const blocked = createMockTask({ id: 'task-pr42', prNumber: 42, repository: 'pbuchman/intexuraos' });
      const free = createMockTask({ id: 'task-pr99', prNumber: 99, repository: 'pbuchman/intexuraos' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([blocked, free]));
      mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockImplementation(
        async (_repo: string, prNumber: number) => {
          if (prNumber === 42) return ok({ hasActive: true, taskId: 'running-on-42' });
          return ok({ hasActive: false });
        }
      );
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ id: 'task-pr99', status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-pr99' });
      }
    });

    it('returns still_busy when all candidates are blocked by per-PR guard', async () => {
      const task1 = createMockTask({ id: 'task-1', prNumber: 42, repository: 'pbuchman/intexuraos' });
      const task2 = createMockTask({ id: 'task-2', prNumber: 99, repository: 'pbuchman/intexuraos' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task1, task2]));
      mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockResolvedValue(
        ok({ hasActive: true, taskId: 'some-running-task' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(task1));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
      }
    });

    it('dispatches task without prNumber (no per-PR guard applies)', async () => {
      const task = createMockTask({ id: 'task-no-pr', linearIssueId: 'INT-100' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: 'issue-id', identifier: 'INT-100', title: 'Test', url: 'https://linear.app', labels: [], childCount: 0 })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ id: 'task-no-pr', status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-no-pr' });
      }
      // Per-PR guard should NOT have been called for a task without prNumber
      expect(mockCodeTaskRepo.hasDispatchedOrRunningForPR).not.toHaveBeenCalled();
    });

    it('round-robin: picks tasks from different PRs in creation order', async () => {
      // PR 42 has 2 tasks, PR 99 has 1 — round-robin should pick PR 42 first (oldest), then PR 99
      const olderTs = Timestamp.fromDate(new Date(Date.now() - 5000));
      const newerTs = Timestamp.fromDate(new Date(Date.now() - 3000));
      const newestTs = Timestamp.fromDate(new Date(Date.now() - 1000));

      const pr42_task1 = createMockTask({ id: 'task-pr42-a', prNumber: 42, repository: 'pbuchman/intexuraos', createdAt: olderTs });
      const pr42_task2 = createMockTask({ id: 'task-pr42-b', prNumber: 42, repository: 'pbuchman/intexuraos', createdAt: newestTs });
      const pr99_task1 = createMockTask({ id: 'task-pr99-a', prNumber: 99, repository: 'pbuchman/intexuraos', createdAt: newerTs });

      // listQueuedByAge returns global FIFO: pr42_task1, pr99_task1, pr42_task2
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([pr42_task1, pr99_task1, pr42_task2]));

      // PR 42 is blocked, PR 99 is free
      mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockImplementation(
        async (_repo: string, prNumber: number) => {
          if (prNumber === 42) return ok({ hasActive: true, taskId: 'running-on-42' });
          return ok({ hasActive: false });
        }
      );
      setupWorkerSettings();

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ id: 'task-pr99-a', status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      // Round-robin tried PR 42 first (blocked), then PR 99 (dispatched)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-pr99-a' });
      }
    });

    it('round-robin: oldest non-PR task dispatches before newer PR-scoped task', async () => {
      // Regression: non-PR tasks (planning/execution) must not be starved behind newer PR work
      const olderTs = Timestamp.fromDate(new Date(Date.now() - 10_000));
      const newerTs = Timestamp.fromDate(new Date(Date.now() - 3000));

      const planningTask = createMockTask({
        id: 'task-planning',
        linearIssueId: 'INT-200',
        createdAt: olderTs,
        queuedAt: olderTs,
        // no prNumber — this is a planning task
      });
      const prTask = createMockTask({
        id: 'task-pr-newer',
        prNumber: 55,
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-201',
        createdAt: newerTs,
        queuedAt: newerTs,
      });

      // listQueuedByAge returns global FIFO: planning first, then PR task
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([planningTask, prTask]));
      mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockResolvedValue(ok({ hasActive: false }));
      setupWorkerSettings();

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: 'issue-id', identifier: 'INT-200', title: 'Test', url: 'https://linear.app', labels: [], childCount: 0 })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ id: 'task-planning', status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        // The older planning task (no prNumber) must be dispatched, not the newer PR task
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-planning' });
      }
      // Per-PR guard should NOT have been called for the planning task (no prNumber)
      expect(mockCodeTaskRepo.hasDispatchedOrRunningForPR).not.toHaveBeenCalled();
    });

    it('TTL expires a non-PR-locked task that has passed its TTL', async () => {
      // Regression test: an expired PR task that is NOT PR-locked should be TTL-expired.
      // Under the new ordering, PR-lock check runs first (returns hasActive: false),
      // then the TTL check fires and expires the task.
      const beyondTtl = new Date(Date.now() - 1441 * 60 * 1000);
      const expiredTask = createMockTask({
        id: 'task-expired',
        prNumber: 42,
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-100',
        agentType: 'pull_request',
        queuedAt: Timestamp.fromDate(beyondTtl),
      });
      const blockedTask = createMockTask({
        id: 'task-blocked',
        prNumber: 42,
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-100',
        agentType: 'review',
      });

      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([expiredTask, blockedTask]));
      mockCodeTaskRepo.update.mockResolvedValue(ok(expiredTask));
      // No active task for PR 42 — so expiredTask passes the PR-lock check, then hits TTL
      mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockResolvedValue(ok({ hasActive: false }));

      const result = await drainTaskQueue(createDeps());

      // PR-lock check runs first, then TTL check fires — expired task cleaned up
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(expect.objectContaining({ action: 'expired', taskId: 'task-expired' }));
      }

      // Verify task was marked as failed
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-expired', {
        status: 'failed',
        error: {
          code: 'queue_timeout',
          message: 'Task expired in queue after 1440 minutes before a worker could start.',
        },
        dispatchStatus: expect.objectContaining({
          state: 'terminal',
          reason: 'queue_timeout',
          terminal: true,
          nextAction: 'retry_after_fix',
        }),
      });

      // Verify per-PR guard WAS called (it runs before TTL in the new ordering)
      expect(mockCodeTaskRepo.hasDispatchedOrRunningForPR).toHaveBeenCalledWith('pbuchman/intexuraos', 42);
    });
  });

  describe('fan-out check (INT-962)', () => {
    it('dispatches planning execution follow-up as one task even when the issue has children', async () => {
      const task = createMockTask({
        linearIssueId: 'INT-1841',
        agentType: 'execution',
        parentTaskId: 'task_planning',
        followUpReason: 'execution_implement',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'parent-uuid',
          identifier: 'INT-1841',
          title: 'Parent issue',
          url: 'https://linear.app/intexura/issue/INT-1841',
          labels: ['code-task'],
          childCount: 2,
          parentId: null,
        }),
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
      }
      expect(mockLinearAgentClient.fetchDirectChildrenLive).not.toHaveBeenCalled();
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123' }),
      );
    });

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

      // fetchDirectChildrenLive returns children with code-task labels
      mockLinearAgentClient.fetchDirectChildrenLive.mockResolvedValue(
        ok([
          { id: 'child-uuid-1', identifier: 'INT-957', url: '', parentId: 'parent-uuid', labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          { id: 'child-uuid-2', identifier: 'INT-958', url: '', parentId: 'parent-uuid', labels: ['code-task'], assigneeId: null, state: 'Backlog' },
        ])
      );

      mockCodeTaskRepo.create.mockResolvedValue(ok(createMockTask({ id: 'child-task' })));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'implemented' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('dispatched');
        expect(result.value.taskId).toMatch(/^task_/);
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

      mockLinearAgentClient.fetchDirectChildrenLive.mockResolvedValue(
        ok([
          { id: 'child-uuid-1', identifier: 'INT-959', url: '', parentId: 'parent-uuid', labels: ['feature'], assigneeId: null, state: 'Backlog' },
        ])
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

    it('falls back to normal dispatch when live parent UUID is missing from validation response', async () => {
      const task = createMockTask({ linearIssueId: 'INT-956' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: undefined as unknown as string,
          identifier: 'INT-956',
          title: 'Parent issue',
          url: 'https://linear.app/intexura/issue/INT-956',
          labels: ['code-task'],
          childCount: 2,
          parentId: null,
        }),
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
      }
      expect(mockLinearAgentClient.fetchDirectChildrenLive).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123', linearIssueId: 'INT-956' }),
        'Drain fan-out skipped: live parent UUID unavailable',
      );
    });

    it('logs a warning and still returns dispatched when parent cancellation fails after successful fan-out', async () => {
      const task = createMockTask({ linearIssueId: 'INT-956', agentType: 'execution' });
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
        }),
      );
      mockLinearAgentClient.fetchDirectChildrenLive.mockResolvedValue(
        ok([
          { id: 'child-uuid-1', identifier: 'INT-957', url: '', parentId: 'parent-uuid', labels: ['code-task'], assigneeId: null, state: 'Backlog' },
        ]),
      );
      mockCodeTaskRepo.create.mockResolvedValue(ok(createMockTask({ id: 'child-task' })));
      mockCodeTaskRepo.update
        .mockResolvedValueOnce(ok(createMockTask({ implementationTaskId: 'child-task' })))
        .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'cancel failed' }));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('dispatched');
        expect(result.value.taskId).toMatch(/^task_/);
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123', error: { code: 'FIRESTORE_ERROR', message: 'cancel failed' } }),
        'Drain fan-out succeeded but failed to cancel parent task',
      );
    });

    it('falls back to normal dispatch when live direct-children fetch fails', async () => {
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
          childCount: 2,
          parentId: null,
        }),
      );
      mockLinearAgentClient.fetchDirectChildrenLive.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'children unavailable' }),
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'task-123' });
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          linearIssueId: 'INT-956',
          error: { code: 'UNAVAILABLE', message: 'children unavailable' },
        }),
        'Drain fan-out could not fetch live direct children, falling back to normal dispatch',
      );
    });
  });

  describe('queued review merge (INT-1014)', () => {
    it('keeps queued reviews for different users on the same PR isolated', async () => {
      const firstUserReview = createMockTask({
        id: 'review-user-1',
        userId: 'user-1',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        prBranch: 'fix/review-branch',
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      const secondUserReview = createMockTask({
        id: 'review-user-2',
        userId: 'user-2',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        prBranch: 'fix/review-branch',
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([firstUserReview, secondUserReview]));
      setupWorkerSettings();
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result).toEqual(ok({ action: 'dispatched', taskId: 'review-user-1' }));
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        'review-user-1',
        expect.objectContaining({ status: 'cancelled' }),
      );
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        'review-user-2',
        expect.objectContaining({ status: 'cancelled' }),
      );
    });

    it('merges 2 duplicate queued reviews for same PR — oldest cancelled, newest dispatched', async () => {
      // Older review (createdAt first)
      const olderReview = createMockTask({
        id: 'review-old',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        prBranch: 'fix/review-branch',
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)), // 10 min ago
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      // Newer review (createdAt later)
      const newerReview = createMockTask({
        id: 'review-new',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        prBranch: 'fix/review-branch',
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
        prBranch: 'fix/review-branch',
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 30 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 30 * 60 * 1000)),
      });
      const review2 = createMockTask({
        id: 'review-2',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        prBranch: 'fix/review-branch',
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
      });
      const review3 = createMockTask({
        id: 'review-3',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        prBranch: 'fix/review-branch',
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
        prBranch: 'fix/review-branch',
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      const reviewNew = createMockTask({
        id: 'review-new',
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        prBranch: 'fix/review-branch',
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
        // and was picked first in FIFO dispatch order before per-PR guard could block it
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
        prBranch: 'fix/review-branch-42',
        agentType: 'review',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      const reviewPR99 = createMockTask({
        id: 'review-pr99',
        repository: 'pbuchman/intexuraos',
        prNumber: 99,
        prBranch: 'fix/review-branch-99',
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
      expect(dispatchCall['trackingCommentId']).toBeUndefined();
      expect(dispatchCall['retriedFrom']).toBeUndefined();
    });
  });

  // Fix A: drainTaskQueue keeps task queued for retryable dispatch errors.
  describe('retryable dispatch errors keep task queued (Fix A)', () => {
    it('keeps the claim and lease when the worker POST outcome is unknown', async () => {
      const task = createMockTask();
      const dispatchError = {
        code: 'network_error' as const,
        message: 'Gateway timed out after accepting the POST',
        outcomeUnknown: true,
        workerLocation: 'home-mac',
      };
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
      mockTaskDispatcher.dispatch.mockResolvedValue(err(dispatchError));
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result).toEqual(ok({ action: 'still_busy', taskId: 'task-123' }));
      expect(mockCodeTaskRepo.rollbackDispatch).not.toHaveBeenCalled();
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'task-123',
        expect.objectContaining({
          dispatchStatus: expect.objectContaining({
            state: 'waiting',
            reason: 'network_error',
            terminal: false,
          }),
          workerLocation: 'home-mac',
        }),
      );
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        'task-123',
        expect.objectContaining({ status: 'queued' }),
      );
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        'task-123',
        expect.objectContaining({ status: 'failed' }),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        {
          remediationFamily: 'code-task.dispatch',
          taskId: 'task-123',
          dispatchAttemptId: 'test-dispatch-token',
          error: dispatchError,
        },
        'Worker POST outcome is unknown; retaining the dispatch claim and user lease',
      );
    });

    it('keeps the existing worker location when an unknown outcome has no target metadata', async () => {
      const task = createMockTask({ workerLocation: 'existing-worker' });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({
        code: 'network_error',
        message: 'Unknown POST outcome without worker metadata',
        outcomeUnknown: true,
      } as never));
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result).toEqual(ok({ action: 'still_busy', taskId: 'task-123' }));
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'task-123',
        expect.not.objectContaining({ workerLocation: expect.anything() }),
      );
      expect(mockCodeTaskRepo.rollbackDispatch).not.toHaveBeenCalled();
    });

    it('returns internal_error without releasing the claim when unknown outcome persistence fails', async () => {
      const task = createMockTask();
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({
        code: 'network_error',
        message: 'Unknown POST outcome',
        outcomeUnknown: true,
        workerLocation: 'home-mac',
      } as never));
      mockCodeTaskRepo.update.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'write failed',
      }));

      const result = await drainTaskQueue(createDeps());

      expect(result).toEqual(err({
        code: 'internal_error',
        message: 'Failed to persist unknown dispatch outcome',
      }));
      expect(mockCodeTaskRepo.rollbackDispatch).not.toHaveBeenCalled();
    });

    it.each(['worker_unavailable', 'network_error'])(
      'keeps task queued and rolls back claim without resetting queuedAt for retryable code %s',
      async (code) => {
        const initialQueuedAtMs = Date.now() - 10 * 60 * 1000;
        const task = createMockTask({
          queuedAt: Timestamp.fromDate(new Date(initialQueuedAtMs)),
        });
        mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
        setupWorkerSettings();
        mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
        mockTaskDispatcher.dispatch.mockResolvedValue(
          err({ code, message: `Transient: ${code}` }),
        );
        mockCodeTaskRepo.update.mockResolvedValue(ok(task));

        const result = await drainTaskQueue(createDeps());

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
        }

        // Claim was rolled back to queued so the next drain cycle can retry.
        expect(mockCodeTaskRepo.rollbackDispatch).toHaveBeenCalledWith(
          'task-123',
          'test-dispatch-token',
          expect.objectContaining({
            state: 'waiting',
            reason: code,
            terminal: false,
            nextAction: 'will_retry_automatically',
          }),
        );

        // queuedAt MUST NOT be reset — TTL must still bound the queue lifetime.
        const queuedAtResetCall = mockCodeTaskRepo.update.mock.calls.find(
          (call: unknown[]): boolean => {
            const arg = call[1] as Record<string, unknown> | undefined;
            return arg !== undefined && 'queuedAt' in arg;
          },
        );
        expect(queuedAtResetCall).toBeUndefined();

        // Task was NOT marked failed.
        const failedCall = mockCodeTaskRepo.update.mock.calls.find(
          (call: unknown[]): boolean => {
            const arg = call[1] as Record<string, unknown> | undefined;
            return arg !== undefined && arg['status'] === 'failed';
          },
        );
        expect(failedCall).toBeUndefined();
      },
    );

    it.each(['dispatch_failed', 'invalid_response'])(
      'permanent code %s still finalizes as failed',
      async (code) => {
        const task = createMockTask();
        const dispatchError = { code, message: `Permanent: ${code}` };
        mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
        setupWorkerSettings();
        mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
        mockTaskDispatcher.dispatch.mockResolvedValue(
          err(dispatchError),
        );
        mockCodeTaskRepo.update.mockResolvedValue(ok(task));

        const result = await drainTaskQueue(createDeps());

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual(
            expect.objectContaining({ action: 'failed', taskId: 'task-123' }),
          );
        }

        expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
          status: 'failed',
          error: {
            code: `dispatch_blocked_${code}`,
            message: expect.stringContaining(`Permanent: ${code}`),
            remediation: expect.objectContaining({
              action: 'retry',
            }),
          },
          dispatchStatus: expect.objectContaining({
            state: 'terminal',
            reason: code,
            terminal: true,
            nextAction: 'retry_after_fix',
          }),
        }));
        expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
          expect.objectContaining({ dispatchAttemptId: 'test-dispatch-token' }),
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          {
            remediationFamily: 'code-task.dispatch',
            taskId: 'task-123',
            dispatchAttemptId: 'test-dispatch-token',
            error: dispatchError,
          },
          'Drain dispatch failed with permanent error',
        );
      },
    );
  });

  // Fix B: Linear-issue concurrency guard for review tasks.
  describe('Linear-issue concurrency guard for reviews (Fix B)', () => {
    it('defers review when another task on the same Linear issue is dispatched/running', async () => {
      const initialQueuedAtMs = Date.now() - 10 * 60 * 1000;
      const reviewTask = createMockTask({
        id: 'review-task',
        agentType: 'review',
        prNumber: 1,
        prBranch: 'fix/branch',
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-1529',
        queuedAt: Timestamp.fromDate(new Date(initialQueuedAtMs)),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([reviewTask]));
      mockCodeTaskRepo.hasOtherDispatchedOrRunningForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'planning-running' }),
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
      }
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
      expect(mockCodeTaskRepo.hasOtherDispatchedOrRunningForLinearIssue).toHaveBeenCalledWith(
        'review-task',
        'INT-1529',
      );

      // queuedAt MUST NOT be reset — TTL still applies.
      const queuedAtResetCall = mockCodeTaskRepo.update.mock.calls.find(
        (call: unknown[]): boolean => {
          const arg = call[1] as Record<string, unknown> | undefined;
          return arg !== undefined && 'queuedAt' in arg;
        },
      );
      expect(queuedAtResetCall).toBeUndefined();
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('review-task', {
        dispatchStatus: expect.objectContaining({
          state: 'waiting',
          reason: 'active_task_blocked',
          nextAction: 'wait_for_active_task',
        }),
      });
    });

    it('logs warning and continues when active Linear issue wait status persistence fails', async () => {
      const reviewTask = createMockTask({
        id: 'review-task',
        agentType: 'review',
        prNumber: 1,
        prBranch: 'fix/branch',
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-1529',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([reviewTask]));
      mockCodeTaskRepo.hasOtherDispatchedOrRunningForLinearIssue.mockResolvedValue(
        ok({ hasActive: true, taskId: 'planning-running' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'review-task', activeTaskId: 'planning-running' }),
        'Failed to persist active-task dispatch wait status',
      );
    });

    it('two queued reviews on same Linear issue do NOT deadlock — one dispatches', async () => {
      // Both reviews are 'queued', so DISPATCHED_OR_RUNNING_STATUSES filter returns hasActive: false.
      const review1 = createMockTask({
        id: 'review-1',
        agentType: 'review',
        prNumber: 1,
        prBranch: 'fix/r1',
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-1529',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 10 * 60 * 1000)),
      });
      const review2 = createMockTask({
        id: 'review-2',
        agentType: 'review',
        prNumber: 2,
        prBranch: 'fix/r2',
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-1529',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([review1, review2]));
      mockCodeTaskRepo.hasOtherDispatchedOrRunningForLinearIssue.mockResolvedValue(
        ok({ hasActive: false }),
      );
      setupWorkerSettings();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'issue-id',
          identifier: 'INT-1529',
          title: 'T',
          url: 'https://linear.app',
          labels: [],
          childCount: 0,
          parentId: null,
        }),
      );
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'review-1' });
      }
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledTimes(1);
    });

    it('different-PR same-issue reviews dispatch when no active sibling exists', async () => {
      const review = createMockTask({
        id: 'review-pr2',
        agentType: 'review',
        prNumber: 2,
        prBranch: 'fix/pr2',
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-1529',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([review]));
      mockCodeTaskRepo.hasOtherDispatchedOrRunningForLinearIssue.mockResolvedValue(
        ok({ hasActive: false }),
      );
      setupWorkerSettings();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'issue-id',
          identifier: 'INT-1529',
          title: 'T',
          url: 'https://linear.app',
          labels: [],
          childCount: 0,
          parentId: null,
        }),
      );
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'review-pr2' });
      }
    });

    it('non-review candidate (planning) is NOT gated by the Linear-issue guard', async () => {
      const planningTask = createMockTask({
        id: 'planning-task',
        agentType: 'planning',
        linearIssueId: 'INT-1529',
        // No prNumber — planning tasks dispatch without PR.
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([planningTask]));
      setupWorkerSettings();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'issue-id',
          identifier: 'INT-1529',
          title: 'T',
          url: 'https://linear.app',
          labels: [],
          childCount: 0,
          parentId: null,
        }),
      );
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'planning-task' });
      }
      // Linear-issue guard never consulted for non-review candidates.
      expect(mockCodeTaskRepo.hasOtherDispatchedOrRunningForLinearIssue).not.toHaveBeenCalled();
    });

    it('falls through (continues drain) when guard returns err — does not block forever', async () => {
      const reviewTask = createMockTask({
        id: 'review-task',
        agentType: 'review',
        prNumber: 1,
        prBranch: 'fix/branch',
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-1529',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([reviewTask]));
      // Guard returns err — drain proceeds (does not defer).
      mockCodeTaskRepo.hasOtherDispatchedOrRunningForLinearIssue.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'boom' }),
      );
      setupWorkerSettings();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({
          id: 'issue-id',
          identifier: 'INT-1529',
          title: 'T',
          url: 'https://linear.app',
          labels: [],
          childCount: 0,
          parentId: null,
        }),
      );
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      // Guard error does not block dispatch — the task proceeds.
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'review-task' });
      }
    });
  });

  // Fix E: atomic dispatch claim via Firestore transaction.
  describe('atomic dispatch claim (Fix E)', () => {
    it('skips task and returns still_busy when claim returns alreadyClaimed', async () => {
      const task = createMockTask();
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(
        ok({ kind: 'task_not_queued' }),
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
      }
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('skips task and returns still_busy when claim returns err', async () => {
      const task = createMockTask();
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'txn aborted' }),
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
      }
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('skips task when claim returns notFound', async () => {
      const task = createMockTask();
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(
        ok({ kind: 'task_not_queued' }),
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
      }
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('rolls back claim to queued on retryable dispatch error', async () => {
      const task = createMockTask();
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed('rollback-token')));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'worker_unavailable', message: 'all probes failed' }),
      );
      mockCodeTaskRepo.rollbackDispatch.mockResolvedValue(ok(true));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy', taskId: 'task-123' });
      }

      expect(mockCodeTaskRepo.claimForDispatch).toHaveBeenCalledWith('task-123');
      // Rollback is fenced by the exact token returned by the atomic claim.
      expect(mockCodeTaskRepo.rollbackDispatch).toHaveBeenCalledWith(
        'task-123',
        'rollback-token',
        expect.objectContaining({
          state: 'waiting',
          reason: 'worker_unavailable',
        }),
      );
    });

    it('returns internal_error when claim rollback fails after retryable dispatch error', async () => {
      const task = createMockTask();
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed('rollback-token')));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'worker_unavailable', message: 'all probes failed' }),
      );
      mockCodeTaskRepo.rollbackDispatch.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'rollback write failed' }),
      );

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          code: 'internal_error',
          message: 'Failed to persist recoverable dispatch status',
        });
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123' }),
        'Failed to roll back claim after retryable dispatch error',
      );
    });

    it('does not roll back claim on permanent dispatch error (failure path overwrites status)', async () => {
      const task = createMockTask();
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'dispatch_failed', message: 'bad worker response' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(
          expect.objectContaining({ action: 'failed', taskId: 'task-123' }),
        );
      }

      // No rollback to 'queued'.
      const queuedRollbackCall = mockCodeTaskRepo.update.mock.calls.find(
        (call: unknown[]): boolean => {
          const arg = call[1] as Record<string, unknown> | undefined;
          return arg !== undefined && arg['status'] === 'queued';
        },
      );
      expect(queuedRollbackCall).toBeUndefined();

      // Failure path overwrites status to 'failed'.
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', expect.objectContaining({
        status: 'failed',
        error: {
          code: 'dispatch_blocked_dispatch_failed',
          message: expect.stringContaining('bad worker response'),
          remediation: expect.objectContaining({
            action: 'retry',
          }),
        },
        dispatchStatus: expect.objectContaining({
          reason: 'dispatch_failed',
          terminal: true,
        }),
      }));
    });

    it('skips a busy user without mutating that task and dispatches the next user', async () => {
      const busyTask = createMockTask({ id: 'task-busy-user', userId: 'user-busy' });
      const freeTask = createMockTask({
        id: 'task-free-user',
        userId: 'user-free',
        prompt: 'Free user task',
        sanitizedPrompt: 'Free user task',
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([busyTask, freeTask]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockImplementation(async (taskId: string) =>
        taskId === 'task-busy-user'
          ? ok({ kind: 'user_busy' as const, activeTaskId: 'task-active-for-busy-user' })
          : ok({ kind: 'claimed' as const, dispatchToken: 'free-user-token' })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok({ ...freeTask, status: 'dispatched' }));

      const result = await drainTaskQueue(createDeps());

      expect(result).toEqual({
        ok: true,
        value: { action: 'dispatched', taskId: 'task-free-user' },
      });
      expect(mockCodeTaskRepo.claimForDispatch).toHaveBeenNthCalledWith(1, 'task-busy-user');
      expect(mockCodeTaskRepo.claimForDispatch).toHaveBeenNthCalledWith(2, 'task-free-user');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-free-user' }),
      );
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        'task-busy-user',
        expect.anything(),
      );
    });
  });

  describe('schedule-aware draining (INT-1463)', () => {
    it('skips a scheduled task that is not yet eligible and records a scheduled wait status', async () => {
      const now = Date.now();
      const task = createMockTask({
        id: 'scheduled-task',
        queuedAt: Timestamp.fromDate(new Date(now - 60 * 1000)),
        dispatchSchedule: {
          notBeforeAt: Timestamp.fromDate(new Date(now + 10 * 60 * 1000)),
          source: 'user_scheduled',
          derivedBy: 'user_input',
        },
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy' });
      }

      // Not dispatched, no queuedAt reset/status change; only the dispatch wait explanation is recorded.
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('scheduled-task', {
        dispatchStatus: expect.objectContaining({
          state: 'waiting',
          reason: 'scheduled_wait',
          nextAction: 'wait_until_scheduled',
        }),
      });
    });

    it('preserves scheduled wait firstSeenAt and notification ledger when the task is still waiting', async () => {
      const now = Date.now();
      const firstSeenAt = Timestamp.fromDate(new Date(now - 30 * 60 * 1000));
      const notifiedAt = Timestamp.fromDate(new Date(now - 20 * 60 * 1000));
      const task = createMockTask({
        id: 'scheduled-task',
        queuedAt: Timestamp.fromDate(new Date(now - 60 * 1000)),
        dispatchSchedule: {
          notBeforeAt: Timestamp.fromDate(new Date(now + 10 * 60 * 1000)),
          source: 'user_scheduled',
          derivedBy: 'user_input',
        },
        dispatchStatus: {
          state: 'waiting',
          reason: 'scheduled_wait',
          terminal: false,
          severity: 'info',
          message: 'Already waiting.',
          remediation: 'Wait.',
          workerNames: [],
          firstSeenAt,
          lastSeenAt: firstSeenAt,
          nextAction: 'wait_until_scheduled',
          notifiedReasons: {
            queue_full: notifiedAt,
          },
        },
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('scheduled-task', {
        dispatchStatus: expect.objectContaining({
          reason: 'scheduled_wait',
          firstSeenAt,
          notifiedReasons: {
            queue_full: notifiedAt,
          },
        }),
      });
    });

    it('logs and continues when scheduled wait status persistence fails', async () => {
      const now = Date.now();
      const task = createMockTask({
        id: 'scheduled-task',
        queuedAt: Timestamp.fromDate(new Date(now - 60 * 1000)),
        dispatchSchedule: {
          notBeforeAt: Timestamp.fromDate(new Date(now + 10 * 60 * 1000)),
          source: 'user_scheduled',
          derivedBy: 'user_input',
        },
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
      );
      setupWorkerSettings();

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy' });
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'scheduled-task' }),
        'Failed to persist scheduled dispatch wait status',
      );
    });

    it('logs future-scheduled eligibility as the all-candidates reason instead of active-resource blocking', async () => {
      const now = Date.now();
      const task = createMockTask({
        id: 'cooloff-retry-waiting',
        queuedAt: Timestamp.fromDate(new Date(now - 60 * 1000)),
        dispatchSchedule: {
          notBeforeAt: Timestamp.fromDate(new Date(now + 5 * 60 * 1000)),
          source: 'retry_cooloff',
          derivedBy: 'fallback',
        },
      });
      const laterTask = createMockTask({
        id: 'cooloff-retry-waiting-later',
        createdAt: Timestamp.fromDate(new Date(now + 1)),
        queuedAt: Timestamp.fromDate(new Date(now - 30 * 1000)),
        dispatchSchedule: {
          notBeforeAt: Timestamp.fromDate(new Date(now + 10 * 60 * 1000)),
          source: 'retry_cooloff',
          derivedBy: 'fallback',
        },
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task, laterTask]));
      setupWorkerSettings();

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy' });
      }
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateCount: 2,
          futureScheduledCount: 2,
          nextEligibleAt: expect.any(String),
        }),
        'All queued tasks are future-scheduled and not yet eligible',
      );
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        'All queued tasks blocked by active resources',
      );
    });

    it('dispatches an eligible unscheduled task ahead of an older future-scheduled row', async () => {
      const now = Date.now();
      const olderScheduled = createMockTask({
        id: 'older-scheduled',
        createdAt: Timestamp.fromDate(new Date(now - 30 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(now - 30 * 60 * 1000)),
        dispatchSchedule: {
          notBeforeAt: Timestamp.fromDate(new Date(now + 60 * 60 * 1000)),
          source: 'user_scheduled',
          derivedBy: 'user_input',
        },
      });
      const newerUnscheduled = createMockTask({
        id: 'newer-unscheduled',
        createdAt: Timestamp.fromDate(new Date(now - 2 * 60 * 1000)),
        queuedAt: Timestamp.fromDate(new Date(now - 2 * 60 * 1000)),
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([olderScheduled, newerUnscheduled]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'newer-unscheduled' });
      }
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledTimes(1);
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'newer-unscheduled' }),
      );
    });

    it('does not expire a scheduled task whose notBeforeAt is still in the future even if queuedAt is past TTL', async () => {
      const now = Date.now();
      const task = createMockTask({
        id: 'long-wait-scheduled',
        // queuedAt 25h ago — would normally be expired under 1440-minute TTL.
        queuedAt: Timestamp.fromDate(new Date(now - 25 * 60 * 60 * 1000)),
        dispatchSchedule: {
          notBeforeAt: Timestamp.fromDate(new Date(now + 60 * 60 * 1000)),
          source: 'user_scheduled',
          derivedBy: 'user_input',
        },
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'still_busy' });
      }

      // Must not be marked failed / timed out while schedule wait is still active.
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'failed' }),
      );
      expect(mockWhatsappNotifier.notifyTaskQueueExpired).not.toHaveBeenCalled();
    });

    it('expires a scheduled task when notBeforeAt itself is past TTL (eligible long ago but still undispatched)', async () => {
      const now = Date.now();
      const task = createMockTask({
        id: 'stale-scheduled',
        queuedAt: Timestamp.fromDate(new Date(now - 25 * 60 * 60 * 1000)),
        dispatchSchedule: {
          // notBeforeAt elapsed 25h ago — effectiveEligibleAt = notBeforeAt, and 25h > 24h TTL.
          notBeforeAt: Timestamp.fromDate(new Date(now - 25 * 60 * 60 * 1000)),
          source: 'retry_cooloff',
          derivedBy: 'llm',
        },
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(
          expect.objectContaining({ action: 'expired', taskId: 'stale-scheduled' }),
        );
      }
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('stale-scheduled', {
        status: 'failed',
        error: {
          code: 'queue_timeout',
          message: 'Task expired in queue after 1440 minutes before a worker could start.',
        },
        dispatchStatus: expect.objectContaining({
          state: 'terminal',
          reason: 'queue_timeout',
          terminal: true,
          nextAction: 'retry_after_fix',
        }),
      });
    });

    it('preserves queue timeout firstSeenAt when timeout was already recorded', async () => {
      const now = Date.now();
      const firstSeenAt = Timestamp.fromDate(new Date(now - 2 * 60 * 60 * 1000));
      const task = createMockTask({
        id: 'stale-queued',
        queuedAt: Timestamp.fromDate(new Date(now - 25 * 60 * 60 * 1000)),
        dispatchStatus: {
          state: 'terminal',
          reason: 'queue_timeout',
          terminal: true,
          severity: 'critical',
          message: 'Already timed out.',
          remediation: 'Retry.',
          workerNames: [],
          firstSeenAt,
          lastSeenAt: firstSeenAt,
          nextAction: 'retry_after_fix',
        },
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      mockCodeTaskRepo.update.mockResolvedValue(ok(task));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('stale-queued', expect.objectContaining({
        status: 'failed',
        dispatchStatus: expect.objectContaining({
          reason: 'queue_timeout',
          firstSeenAt,
        }),
      }));
    });

    it('dispatches a scheduled task normally once notBeforeAt has passed, without resetting queuedAt', async () => {
      const now = Date.now();
      const originalQueuedAt = Timestamp.fromDate(new Date(now - 5 * 60 * 1000));
      const task = createMockTask({
        id: 'eligible-scheduled',
        queuedAt: originalQueuedAt,
        dispatchSchedule: {
          notBeforeAt: Timestamp.fromDate(new Date(now - 1)),
          source: 'user_scheduled',
          derivedBy: 'user_input',
        },
      });
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
      setupWorkerSettings();
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed()));

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' })
      );
      mockCodeTaskRepo.update.mockResolvedValue(ok(createMockTask({ status: 'dispatched' })));

      const result = await drainTaskQueue(createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ action: 'dispatched', taskId: 'eligible-scheduled' });
      }
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'eligible-scheduled' }),
      );
      // No queuedAt reset while crossing the schedule boundary.
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith(
        'eligible-scheduled',
        expect.objectContaining({ queuedAt: expect.any(Date) }),
      );
    });

    it('calls listQueuedByAge with config.queue.maxSize (50), not the legacy batch of 10', async () => {
      mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([]));

      await drainTaskQueue(createDeps());

      expect(mockCodeTaskRepo.listQueuedByAge).toHaveBeenCalledTimes(1);
      expect(mockCodeTaskRepo.listQueuedByAge).toHaveBeenCalledWith(50);
    });
  });

  it('treats a stale recoverable rollback fence as an inert concurrent transition', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings();
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed('stale-token')));
    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'worker_unavailable', message: 'worker unavailable' }),
    );
    mockCodeTaskRepo.rollbackDispatch.mockResolvedValue(ok(false));

    const result = await drainTaskQueue(createDeps());

    expect(result).toEqual(ok({ action: 'still_busy', taskId: 'task-123' }));
    expect(mockLogger.info).toHaveBeenCalledWith(
      { taskId: 'task-123' },
      'Skipped stale dispatch rollback because the task or user lease moved on',
    );
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('fails closed when an affected unclaimed task cannot persist a recoverable status', async () => {
    const claimedTask = createMockTask({ id: 'task-claimed' });
    const siblingTask = createMockTask({ id: 'task-sibling' });
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([claimedTask, siblingTask]));
    setupWorkerSettings();
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok(claimed('claim-token')));
    const blocker = {
      dispatchable: false as const,
      reason: 'workers_unreachable' as const,
      severity: 'warning' as const,
      message: 'Worker unavailable',
      remediation: 'Retry automatically',
      workerNames: ['home-mac'],
    };
    mockTaskDispatcher.dispatch.mockResolvedValue(
      err({ code: 'worker_unavailable', message: 'worker unavailable', blocker }),
    );
    mockCodeTaskRepo.rollbackDispatch.mockResolvedValue(ok(true));
    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'sibling update failed' }),
    );

    const result = await drainTaskQueue(createDeps());

    expect(result).toEqual(err({
      code: 'internal_error',
      message: 'Failed to persist recoverable dispatch status',
    }));
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
      'task-sibling',
      expect.objectContaining({ status: 'queued' }),
    );
  });

  it('skips a no-worker task when the owner lease is already busy', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
    setupWorkerSettings([{ ...workerConfig, enabled: false }]);
    mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok({
      kind: 'user_busy',
      activeTaskId: 'task-already-running',
    }));

    const result = await drainTaskQueue(createDeps());

    expect(result.ok).toBe(true);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
    expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
  });
});
