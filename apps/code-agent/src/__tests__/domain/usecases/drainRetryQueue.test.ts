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
import type { CodeTaskDispatchStatusService } from '../../../domain/services/codeTaskDispatchStatusService.js';

const prepareExecutionMemoryContextMock = vi.fn();
let mockExecutionMemoryEnabled = false;
const mockCreateTaskForPRFn = vi.fn();

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
    retryQueue: { maxAttempts: number; ttlMinutes: number };
    serviceUrl: string;
    codeTaskCallbackBaseUrl: string;
    executionMemoryEnabled: boolean;
  } => ({
    retryQueue: { maxAttempts: 3, ttlMinutes: 10 },
    serviceUrl: 'https://code-agent.test',
    codeTaskCallbackBaseUrl: 'https://callback.test',
    executionMemoryEnabled: mockExecutionMemoryEnabled,
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
    claimForProcessing: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let mockCodeTaskRepo: {
    findById: ReturnType<typeof vi.fn>;
    claimForDispatch: ReturnType<typeof vi.fn>;
    rollbackDispatch: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    listQueued: ReturnType<typeof vi.fn>;
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
    notifyTaskDispatchBlocked: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockLogLineRepo: {
    storeBatch: ReturnType<typeof vi.fn>;
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

  const sampleTaskMessageRetryWithContext = {
    ...sampleTaskMessageRetry,
    prTitle: 'Fix the login bug',
    baseBranch: 'feature/login',
  };

  const sampleTaskMessageRetryNullMessage = {
    ...sampleTaskMessageRetry,
    message: null,
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
      codeTaskDispatchStatusService: mockDispatchStatusService,
      createTaskForPRFn: mockCreateTaskForPRFn,
      userServiceClient: mockUserServiceClient as never,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRetryDrainGuard();
    prepareExecutionMemoryContextMock.mockReset();
    mockExecutionMemoryEnabled = false;
    mockCreateTaskForPRFn.mockReset();
    mockCreateTaskForPRFn.mockResolvedValue(ok({ taskId: 'task_fallback_new' }));

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    mockDispatchRetryRepo = {
      findOldest: vi.fn(),
      claimForProcessing: vi.fn().mockResolvedValue(ok(true)),
      delete: vi.fn().mockResolvedValue(ok(undefined)),
      update: vi.fn().mockResolvedValue(ok(undefined)),
      create: vi.fn(),
    };

    mockCodeTaskRepo = {
      findById: vi.fn().mockResolvedValue(ok(sampleTask)),
      claimForDispatch: vi.fn().mockResolvedValue(ok({
        kind: 'claimed',
        dispatchToken: 'retry-dispatch-token',
      })),
      rollbackDispatch: vi.fn().mockResolvedValue(ok(true)),
      update: vi.fn().mockResolvedValue(ok(sampleTask)),
      listQueued: vi.fn().mockResolvedValue(ok([])),
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
      notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn().mockResolvedValue(ok({ workers: [workerConfig] })),
    };

    mockLogLineRepo = {
      storeBatch: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockDispatchStatusService = {
      recordDispatchBlocked: vi.fn().mockResolvedValue(undefined),
      resolveDispatchBlockers: vi.fn().mockResolvedValue(undefined),
    };

    mockUserServiceClient = {
      getLlmClient: vi.fn().mockResolvedValue(ok({ generate: vi.fn() })),
    };
  });

  it('prepares and threads execution memory context for execution task retries', async () => {
    mockExecutionMemoryEnabled = true;
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      ...sampleTask,
      linearIssueId: 'INT-1098',
      agentType: 'execution',
    }));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'matched',
      applicationId: 'app-456',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Retry the callback route change with logging verification',
      matchedMemories: [
        {
          memoryId: 'mem-9',
          title: 'Verify route serialization',
          memoryType: 'verification_pattern',
          score: 0.88,
          appliesWhen: 'Route schema changes',
          action: 'Update schema and app.inject coverage',
          avoid: 'Do not patch the handler alone',
          verification: 'Check route response shape',
        },
      ],
    });

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledOnce();
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
      executionMemoryContext: expect.objectContaining({
        status: 'matched',
        applicationId: 'app-456',
      }),
    }));
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'execution',
      executionMemoryContext: {
        applicationId: 'app-456',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Retry the callback route change with logging verification',
        matchedMemories: [
          expect.objectContaining({ memoryId: 'mem-9' }),
        ],
      },
    }));
  });

  it('logs a warning when persisting execution memory context fails but still proceeds with dispatch', async () => {
    mockExecutionMemoryEnabled = true;
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      ...sampleTask,
      linearIssueId: 'INT-1098',
      agentType: 'execution',
    }));
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'matched',
      applicationId: 'app-456',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Some query',
      matchedMemories: [],
    });
    // First update (memory persistence) fails; subsequent updates (task status) succeed
    mockCodeTaskRepo.update
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'write failed' }))
      .mockResolvedValue(ok(sampleTask));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_xyz',
        error: expect.objectContaining({ code: 'FIRESTORE_ERROR' }),
      }),
      'Failed to persist execution memory context before dispatch'
    );
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalled();
    if (!result.ok) return;
    expect(result.value.action).toBe('dispatched');
  });

  it('logs warning when execution memory retrieval returns error status and still dispatches', async () => {
    mockExecutionMemoryEnabled = true;
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      ...sampleTask,
      linearIssueId: 'INT-1098',
      agentType: 'execution',
    }));
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'error',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Some query',
      errorCode: 'embedding_failed',
      errorMessage: 'API timeout',
    });
    mockCodeTaskRepo.update.mockResolvedValue(ok(sampleTask));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_xyz',
        errorCode: 'embedding_failed',
        errorMessage: 'API timeout',
      }),
      'Execution memory retrieval returned error status'
    );
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalled();
    if (!result.ok) return;
    expect(result.value.action).toBe('dispatched');
  });

  it('falls back to no query client when userServiceClient is not provided', async () => {
    mockExecutionMemoryEnabled = true;
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      ...sampleTask,
      linearIssueId: 'INT-1098',
      agentType: 'execution',
    }));
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'no_match',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'test query',
    });
    mockCodeTaskRepo.update.mockResolvedValue(ok(sampleTask));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const deps = buildDeps();
    delete (deps as Partial<typeof deps>).userServiceClient;
    const result = await drainRetryQueue(deps);

    expect(result.ok).toBe(true);
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ queryClient: undefined }),
    );
  });

  it('warns and falls back when getLlmClient fails for execution memory', async () => {
    mockExecutionMemoryEnabled = true;
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      ...sampleTask,
      linearIssueId: 'INT-1098',
      agentType: 'execution',
    }));
    mockUserServiceClient.getLlmClient.mockResolvedValue(err({ code: 'not_found', message: 'User not found' }));
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'no_match',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'test query',
    });
    mockCodeTaskRepo.update.mockResolvedValue(ok(sampleTask));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_123' }),
      'Failed to resolve user LLM client for execution memory',
    );
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ queryClient: undefined }),
    );
  });

  it('prepares execution memory context for planning task retries', async () => {
    mockExecutionMemoryEnabled = true;
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      ...sampleTask,
      linearIssueId: 'INT-1098',
      agentType: 'planning',
    }));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'matched',
      applicationId: 'app-planning-456',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Retry planning the callback route change',
      matchedMemories: [
        {
          memoryId: 'mem-plan-9',
          title: 'Verify route serialization',
          memoryType: 'verification_pattern',
          score: 0.86,
          appliesWhen: 'Planning route schema changes',
          action: 'Include schema plan in output',
          avoid: 'Do not patch the handler alone',
          verification: 'Check route response shape',
        },
      ],
    });

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledOnce();
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
      executionMemoryContext: expect.objectContaining({
        status: 'matched',
        applicationId: 'app-planning-456',
      }),
    }));
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'planning',
      executionMemoryContext: {
        applicationId: 'app-planning-456',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Retry planning the callback route change',
        matchedMemories: [
          expect.objectContaining({ memoryId: 'mem-plan-9' }),
        ],
      },
    }));
  });

  it('prepares execution memory context for review task retries', async () => {
    mockExecutionMemoryEnabled = true;
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      ...sampleTask,
      linearIssueId: 'INT-1098',
      agentType: 'review',
    }));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'matched',
      applicationId: 'app-review-456',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Retry reviewing the callback route change',
      matchedMemories: [
        {
          memoryId: 'mem-review-9',
          title: 'Check route schema coverage',
          memoryType: 'verification_pattern',
          score: 0.89,
          appliesWhen: 'Reviewing route schema changes',
          action: 'Verify handler and schema coverage',
          avoid: 'Do not skip inline comments',
          verification: 'Check route response shape',
        },
      ],
    });

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledOnce();
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
      executionMemoryContext: expect.objectContaining({
        status: 'matched',
        applicationId: 'app-review-456',
      }),
    }));
    expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'review',
      executionMemoryContext: {
        applicationId: 'app-review-456',
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        querySummary: 'Retry reviewing the callback route change',
        matchedMemories: [
          expect.objectContaining({ memoryId: 'mem-review-9' }),
        ],
      },
    }));
  });

  it('prepares execution memory for pull_request task retries', async () => {
    mockExecutionMemoryEnabled = true;
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      ...sampleTask,
      linearIssueId: 'INT-1098',
      agentType: 'pull_request',
    }));
    prepareExecutionMemoryContextMock.mockResolvedValue({
      status: 'no_memories',
      applicationId: 'app-pr-retry-1',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'PR review retry',
      matchedMemories: [],
    });
    mockCodeTaskRepo.update.mockResolvedValue(ok(sampleTask));
    mockTaskDispatcher.dispatch.mockResolvedValue(ok({ workerLocation: 'home-mac' }));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    expect(prepareExecutionMemoryContextMock).toHaveBeenCalledOnce();
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
    expect(mockDispatchRetryRepo.claimForProcessing).not.toHaveBeenCalled();
  });

  it('skips when the retry entry is already claimed by another drain', async () => {
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockDispatchRetryRepo.claimForProcessing.mockResolvedValue(ok(false));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ action: 'skipped', taskId: 'task_xyz' });
    expect(mockCodeTaskRepo.findById).not.toHaveBeenCalled();
    expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('returns internal_error when the retry entry claim fails', async () => {
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
    mockDispatchRetryRepo.claimForProcessing.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'transaction failed',
    }));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'internal_error',
      message: 'Failed to claim retry entry for processing',
    });
    expect(mockCodeTaskRepo.findById).not.toHaveBeenCalled();
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
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
      status: 'failed',
      error: {
        code: 'retry_expired',
        message: 'Dispatch retry expired after 10 minutes and 0 attempts: worker_unavailable',
      },
      dispatchStatus: expect.objectContaining({
        state: 'terminal',
        reason: 'retry_expired',
        terminal: true,
        nextAction: 'retry_after_fix',
        attemptCount: 0,
        terminalCause: expect.objectContaining({
          reason: 'dispatch_failed',
          message: 'worker_unavailable',
        }),
      }),
    }));
    expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
    expect(mockCodeTaskRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockDispatchRetryRepo.delete.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user_123', expect.objectContaining({
      reason: 'retry_expired',
      exampleTaskId: 'task_xyz',
    }));
    expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
    expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_123',
      workerType: 'opus',
      observedBefore: expect.any(Date),
    }));
  });

  it('keeps retry entry when expired new-task failure status cannot be persisted', async () => {
    const expiredRetry = {
      ...sampleNewTaskRetry,
      createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
    };
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredRetry));
    mockCodeTaskRepo.update.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' }));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to persist retry dispatch failure status',
      });
    }
    expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
  });

  it('returns internal_error when expired retry entry cannot be deleted after task notification', async () => {
    const expiredRetry = {
      ...sampleNewTaskRetry,
      createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
    };
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredRetry));
    mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'internal_error',
      message: 'Failed to delete expired retry entry',
    });
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user_123', expect.objectContaining({
      reason: 'retry_expired',
    }));
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
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
      status: 'failed',
      error: { code: 'retry_exhausted', message: 'Dispatch retry exhausted after 3 attempts: worker_unavailable' },
      dispatchStatus: expect.objectContaining({
        state: 'terminal',
        reason: 'retry_exhausted',
        terminal: true,
        nextAction: 'retry_after_fix',
        attemptCount: 3,
        terminalCause: expect.objectContaining({
          reason: 'dispatch_failed',
          message: 'worker_unavailable',
        }),
      }),
    }));
    expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
    expect(mockCodeTaskRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockDispatchRetryRepo.delete.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user_123', expect.objectContaining({
      reason: 'retry_exhausted',
      exampleTaskId: 'task_xyz',
    }));
    expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
    expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_123',
      workerType: 'opus',
      observedBefore: expect.any(Date),
    }));
  });

  it('keeps retry entry when exhausted new-task failure status cannot be persisted', async () => {
    const exhaustedRetry = {
      ...sampleNewTaskRetry,
      attempts: 3,
      maxAttempts: 3,
    };
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedRetry));
    mockCodeTaskRepo.update.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' }));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to persist retry dispatch failure status',
      });
    }
    expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
  });

  it('returns internal_error when exhausted retry entry cannot be deleted after task notification', async () => {
    const exhaustedRetry = {
      ...sampleNewTaskRetry,
      attempts: 3,
      maxAttempts: 3,
    };
    mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedRetry));
    mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

    const result = await drainRetryQueue(buildDeps());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'internal_error',
      message: 'Failed to delete exhausted retry entry',
    });
    expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user_123', expect.objectContaining({
      reason: 'retry_exhausted',
    }));
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
      expect(mockCodeTaskRepo.claimForDispatch).toHaveBeenCalledWith('task_xyz');
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
        dispatchStatus: null,
        workerLocation: 'home-mac',
        callbackState: expect.objectContaining({
          webhookUrl: 'https://callback.test/internal/webhooks/task-complete',
          callbackBaseUrl: 'https://callback.test',
          owner: 'custom',
        }),
      }));
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookUrl: 'https://callback.test/internal/webhooks/task-complete',
        })
      );
      expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user_123',
        workerType: 'opus',
        observedBefore: expect.any(Date),
      }));
    });

    it('returns internal_error when retry entry cannot be deleted after successful dispatch', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete retry entry after successful dispatch',
      });
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
        dispatchStatus: null,
        workerLocation: 'home-mac',
      }));
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledTimes(1);
    });

    it('skips without dispatching when the task cannot be claimed', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok({ kind: 'task_not_queued' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ action: 'skipped', taskId: 'task_xyz' });
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    });

    it('skips user_busy without mutating the queued task', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(ok({
        kind: 'user_busy',
        activeTaskId: 'task_active_same_user',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result).toEqual({
        ok: true,
        value: { action: 'skipped', taskId: 'task_xyz' },
      });
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
      expect(mockCodeTaskRepo.rollbackDispatch).not.toHaveBeenCalled();
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    });

    it('returns internal_error when claiming the task for retry dispatch fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockCodeTaskRepo.claimForDispatch.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'claim failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to claim retry task for dispatch',
      });
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes stale retry entry without dispatching when task is no longer queued', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok({ ...sampleTask, status: 'dispatched' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('dispatches successfully when dispatch status service is omitted', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));
      mockCodeTaskRepo.update.mockResolvedValue(ok({ ...sampleTask, status: 'dispatched' }));
      const deps = buildDeps();
      delete (deps as Partial<DrainRetryQueueDeps>).codeTaskDispatchStatusService;

      const result = await drainRetryQueue(deps);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockDispatchStatusService.resolveDispatchBlockers).not.toHaveBeenCalled();
    });

    it('forwards prNumber in dispatch request when task has prNumber', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(
        ok({ ...sampleTask, prNumber: 99, agentType: 'review' })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ prNumber: 99 })
      );
    });

    it('does not include prNumber in dispatch request when task has no prNumber', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.not.objectContaining({ prNumber: expect.anything() })
      );
    });

    it('does not include reviewTypes in dispatch request when task has none', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok({ ...sampleTask, reviewTypes: undefined }));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.not.objectContaining({ reviewTypes: expect.anything() })
      );
    });

    it('includes reviewTypes in dispatch when task has them', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(
        ok({
          ...sampleTask,
          reviewTypes: ['code_quality', 'architecture'],
        })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewTypes: ['code_quality', 'architecture'],
        })
      );
    });

    it('forwards timeoutHours to dispatcher when task has it (INT-1585)', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(
        ok({
          ...sampleTask,
          timeoutHours: 8,
        })
      );
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('dispatched');
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutHours: 8 }),
      );
    });

    it('omits timeoutHours from retry dispatch when task has none — backward compat (INT-1585)', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok({ ...sampleTask }));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-mac' }),
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.not.objectContaining({ timeoutHours: expect.anything() }),
      );
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
      expect(mockCodeTaskRepo.rollbackDispatch).toHaveBeenCalledWith(
        'task_xyz',
        'retry-dispatch-token',
        expect.objectContaining({
          state: 'waiting',
          reason: 'worker_unavailable',
        }),
      );
      expect(mockDispatchRetryRepo.update).toHaveBeenCalledWith('dr_abc', expect.objectContaining({ attempts: 1 }));
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    });

    it('retains the claim and worker target when retry POST outcome is unknown', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({
        code: 'network_error',
        message: 'Worker returned invalid JSON after accepting the POST',
        outcomeUnknown: true,
        workerLocation: 'home-mac',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result).toEqual(ok({ action: 'still_busy', taskId: 'task_xyz' }));
      expect(mockCodeTaskRepo.rollbackDispatch).not.toHaveBeenCalled();
      expect(mockDispatchRetryRepo.update).not.toHaveBeenCalled();
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'task_xyz',
        expect.objectContaining({
          workerLocation: 'home-mac',
          dispatchStatus: expect.objectContaining({
            state: 'waiting',
            reason: 'network_error',
            terminal: false,
          }),
        }),
      );
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
    });

    it('retains the existing worker location when retry unknown outcome lacks target metadata', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({
        code: 'network_error',
        message: 'Unknown POST outcome without worker metadata',
        outcomeUnknown: true,
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result).toEqual(ok({ action: 'still_busy', taskId: 'task_xyz' }));
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'task_xyz',
        expect.not.objectContaining({ workerLocation: expect.anything() }),
      );
      expect(mockCodeTaskRepo.rollbackDispatch).not.toHaveBeenCalled();
    });

    it('keeps the claim and retry entry when unknown outcome persistence fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({
        code: 'network_error',
        message: 'Unknown POST outcome',
        outcomeUnknown: true,
        workerLocation: 'home-mac',
      }));
      mockCodeTaskRepo.update.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'write failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result).toEqual(err({
        code: 'internal_error',
        message: 'Failed to persist unknown retry dispatch outcome',
      }));
      expect(mockCodeTaskRepo.rollbackDispatch).not.toHaveBeenCalled();
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    });

    it('keeps the claim when retry entry cleanup fails after an unknown outcome', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({
        code: 'network_error',
        message: 'Unknown POST outcome',
        outcomeUnknown: true,
        workerLocation: 'home-mac',
      }));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'delete failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result).toEqual(err({
        code: 'internal_error',
        message: 'Failed to delete retry entry after unknown dispatch outcome',
      }));
      expect(mockCodeTaskRepo.rollbackDispatch).not.toHaveBeenCalled();
      expect(mockDispatchRetryRepo.update).not.toHaveBeenCalled();
    });

    it('does not update retry metadata when a stale dispatch token loses rollback ownership', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'worker_unavailable', message: 'connection refused' }),
      );
      mockCodeTaskRepo.rollbackDispatch.mockResolvedValue(ok(false));

      const result = await drainRetryQueue(buildDeps());

      expect(result).toEqual({
        ok: true,
        value: { action: 'skipped', taskId: 'task_xyz' },
      });
      expect(mockDispatchRetryRepo.update).not.toHaveBeenCalled();
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
    });

    it('returns internal_error when retry metadata cannot be persisted after retryable dispatch failure', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({ code: 'worker_unavailable', message: 'connection refused' }));
      mockDispatchRetryRepo.update.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'retry update failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to update retry entry',
      });
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
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
        status: 'failed',
        dispatchStatus: expect.objectContaining({
          state: 'terminal',
          reason: 'dispatch_failed',
          terminal: true,
          nextAction: 'retry_after_fix',
        }),
      }));
    });

    it('returns internal_error when terminal retry dispatch failure cannot be persisted', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({ code: 'dispatch_failed', message: 'bad payload' }));
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to persist retry dispatch failure status',
      });
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
    });

    it('returns internal_error when retry entry cannot be deleted after terminal dispatch failure', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(err({ code: 'dispatch_failed', message: 'bad payload' }));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete retry entry after terminal dispatch failure',
      });
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
        status: 'failed',
      }));
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user_123', expect.objectContaining({
        reason: 'dispatch_failed',
      }));
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

    it('returns internal_error when malformed new_task retry entry cannot be deleted', async () => {
      const entryWithoutTaskId = {
        ...sampleNewTaskRetry,
        taskId: undefined,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(entryWithoutTaskId));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete malformed new-task retry entry',
      });
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

    it('returns internal_error when missing-task retry entry cannot be deleted', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(err({ code: 'not_found', message: 'task not found' }));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete retry entry after missing task lookup',
      });
    });

    it('keeps retry entry when task lookup fails transiently for retry', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'read failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to find task for retry',
      });
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    });

    it('returns internal_error when stale retry entry cannot be deleted', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok({ ...sampleTask, status: 'dispatched' }));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete stale new-task retry entry',
      });
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
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

    it('returns internal_error when worker settings failure cannot update retry metadata', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(err({ code: 'not_found', message: 'no settings' }));
      mockDispatchRetryRepo.update.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'retry update failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to update retry entry',
      });
    });

    it('deletes retry entry and fails task immediately when worker settings value is null', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(null));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
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

    it('deletes retry entry and fails task immediately when no enabled workers exist', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [{ ...workerConfig, enabled: false }] }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({
          code: 'dispatch_blocked_no_enabled_workers',
        }),
        dispatchStatus: expect.objectContaining({
          state: 'terminal',
          reason: 'no_enabled_workers',
          terminal: true,
          nextAction: 'retry_after_fix',
        }),
      }));
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user_123', expect.objectContaining({
        reason: 'no_enabled_workers',
        exampleTaskId: 'task_xyz',
      }));
      expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user_123',
        workerType: 'opus',
        observedBefore: expect.any(Date),
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user_123',
          taskId: 'task_xyz',
          workerType: 'opus',
          reason: 'no_enabled_workers',
          _skipSentry: true,
        }),
        'No enabled workers during retry',
      );
    });

    it('does not clear an aggregate while another matching queued task remains blocked', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockCodeTaskRepo.listQueued.mockResolvedValue(ok([{
        ...sampleTask,
        id: 'task_other',
        dispatchStatus: {
          state: 'waiting',
          reason: 'workers_at_capacity',
          terminal: false,
          severity: 'warning',
          message: 'Workers are at capacity',
          remediation: 'Wait for capacity',
          workerNames: ['home-mac'],
          firstSeenAt: Timestamp.now(),
          lastSeenAt: Timestamp.now(),
          nextAction: 'will_retry_automatically',
        },
      }]));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [] }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      expect(mockDispatchStatusService.resolveDispatchBlockers).not.toHaveBeenCalled();
    });

    it('keeps the aggregate and reports an unexpected queue reconciliation failure', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockCodeTaskRepo.listQueued.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'queue read failed',
      }));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [] }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      expect(mockDispatchStatusService.resolveDispatchBlockers).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task_xyz',
          workerType: 'opus',
          error: expect.objectContaining({ message: 'queue read failed' }),
        }),
        'Failed to reconcile queued tasks before resolving retry dispatch blockers'
      );
    });

    it('returns internal_error when retry entry cannot be deleted after no enabled workers', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [{ ...workerConfig, enabled: false }] }));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete retry entry after no enabled workers',
      });
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
        status: 'failed',
      }));
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user_123', expect.objectContaining({
        reason: 'no_enabled_workers',
      }));
    });

    it('returns internal_error and keeps retry entry when terminal task failure persistence fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [{ ...workerConfig, enabled: false }] }));
      mockCodeTaskRepo.update.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          code: 'internal_error',
          message: 'Failed to persist retry dispatch failure status',
        });
      }
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
    });

    it('records dispatch system status when no enabled workers exist', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [{ ...workerConfig, enabled: false }] }));

      await drainRetryQueue(buildDeps());

      expect(mockDispatchStatusService.recordDispatchBlocked).toHaveBeenCalledWith({
        userId: 'user_123',
        workerType: 'opus',
        blocker: expect.objectContaining({
          dispatchable: false,
          reason: 'no_enabled_workers',
        }),
        affectedTaskCount: 1,
        exampleTaskIds: ['task_xyz'],
      });
    });

    it('still fails and notifies when no enabled workers exist and dispatch status service is omitted', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [{ ...workerConfig, enabled: false }] }));
      const deps = buildDeps();
      delete (deps as Partial<DrainRetryQueueDeps>).codeTaskDispatchStatusService;

      const result = await drainRetryQueue(deps);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchStatusService.recordDispatchBlocked).not.toHaveBeenCalled();
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user_123', expect.objectContaining({
        reason: 'no_enabled_workers',
        exampleTaskId: 'task_xyz',
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

    it('records task-level waiting status and sends one notification for recoverable dispatcher blockers', async () => {
      const blocker = {
        dispatchable: false as const,
        reason: 'workers_at_capacity' as const,
        severity: 'warning' as const,
        message: 'All capable workers for opus are currently at capacity.',
        remediation: 'Wait for a running task to finish or add worker capacity.',
        workerNames: ['home-mac'],
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: blocker.message, blocker })
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('retry_failed');
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task_xyz', expect.objectContaining({
        dispatchStatus: expect.objectContaining({
          state: 'waiting',
          reason: 'workers_at_capacity',
          terminal: false,
          nextAction: 'will_retry_automatically',
        }),
      }));
      expect(mockWhatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user_123', expect.objectContaining({
        workerType: 'opus',
        reason: 'workers_at_capacity',
        affectedTaskCount: 1,
        exampleTaskId: 'task_xyz',
      }));
    });

    it('returns internal_error and does not increment attempts when recoverable dispatch status persistence fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'at_capacity', message: 'all workers busy' })
      );
      mockCodeTaskRepo.rollbackDispatch.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          code: 'internal_error',
          message: 'Failed to persist retry dispatch status',
        });
      }
      expect(mockDispatchRetryRepo.update).not.toHaveBeenCalled();
    });

    it('records dispatch system status when dispatcher returns blocker metadata', async () => {
      const blocker = {
        dispatchable: false as const,
        reason: 'claude_auth_unavailable' as const,
        severity: 'critical' as const,
        message: 'No reachable worker has active Claude auth for opus.',
        remediation: 'Refresh Claude authentication on a worker that can run this task.',
        workerNames: ['home-mac'],
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'worker_unavailable', message: blocker.message, blocker })
      );

      await drainRetryQueue(buildDeps());

      expect(mockDispatchStatusService.recordDispatchBlocked).toHaveBeenCalledWith({
        userId: 'user_123',
        workerType: 'opus',
        blocker,
        affectedTaskCount: 1,
        exampleTaskIds: ['task_xyz'],
      });
      expect(mockDispatchStatusService.resolveDispatchBlockers).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user_123',
        workerType: 'opus',
        observedBefore: expect.any(Date),
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

    it('returns internal_error and keeps retry entry when successful dispatch metadata cannot be persisted', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleNewTaskRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(ok(sampleTask));
      mockTaskDispatcher.dispatch.mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' }));
      mockCodeTaskRepo.update.mockResolvedValue(err({ code: 'internal_error', message: 'update failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to persist successful retry dispatch metadata',
      });
      expect(mockWhatsappNotifier.notifyTaskStarted).not.toHaveBeenCalled();
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
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
    it('expires new_task without notification when task lookup fails', async () => {
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
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ retryId: 'dr_abc', taskId: 'task_xyz' }),
        'Expired new-task retry target was not found; skipping task-level dispatch notification'
      );
    });

    it('keeps expired new_task retry entry when task lookup fails transiently', async () => {
      const expiredRetry = {
        ...sampleNewTaskRetry,
        userId: 'user_123',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'read failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to find expired retry task',
      });
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
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

    it('expires task_message without userId and without notification', async () => {
      const expiredMessage = {
        ...sampleTaskMessageRetry,
        userId: undefined,
        createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredMessage));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('expired');
      expect(result.value.taskId).toBe('task_xyz');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
    });

    it('returns an error when deleting expired task_message retry fails', async () => {
      const expiredMessage = {
        ...sampleTaskMessageRetry,
        createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredMessage));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({ code: 'internal_error', message: 'Failed to delete expired retry entry' });
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
    });

    it('logs when expired task_message notification fails after cleanup', async () => {
      const expiredMessage = {
        ...sampleTaskMessageRetry,
        createdAt: Timestamp.fromDate(new Date(Date.now() - 20 * 60 * 1000)),
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(expiredMessage));
      mockWhatsappNotifier.notifyDispatchRetryExhausted.mockResolvedValue(err({
        code: 'notification_failed',
        message: 'wa down',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ retryId: 'dr_def', userId: 'user_123' }),
        'Failed to notify user about expired message retry'
      );
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
    it('exhausts new_task without notification when task lookup fails', async () => {
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
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_abc');
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ retryId: 'dr_abc', taskId: 'task_xyz' }),
        'Exhausted new-task retry target was not found; skipping task-level dispatch notification'
      );
    });

    it('keeps exhausted new_task retry entry when task lookup fails transiently', async () => {
      const exhaustedRetry = {
        ...sampleNewTaskRetry,
        userId: 'user_123',
        attempts: 3,
        maxAttempts: 3,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedRetry));
      mockCodeTaskRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'read failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to find exhausted retry task',
      });
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
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

    it('exhausts task_message without userId and without notification', async () => {
      const exhaustedMessage = {
        ...sampleTaskMessageRetry,
        userId: undefined,
        attempts: 3,
        maxAttempts: 3,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedMessage));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('exhausted');
      expect(result.value.taskId).toBe('task_xyz');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
    });

    it('returns an error when deleting exhausted task_message retry fails', async () => {
      const exhaustedMessage = {
        ...sampleTaskMessageRetry,
        attempts: 3,
        maxAttempts: 3,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedMessage));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'delete failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({ code: 'internal_error', message: 'Failed to delete exhausted retry entry' });
      expect(mockWhatsappNotifier.notifyDispatchRetryExhausted).not.toHaveBeenCalled();
    });

    it('logs when exhausted task_message notification fails after cleanup', async () => {
      const exhaustedMessage = {
        ...sampleTaskMessageRetry,
        attempts: 3,
        maxAttempts: 3,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(exhaustedMessage));
      mockWhatsappNotifier.notifyDispatchRetryExhausted.mockResolvedValue(err({
        code: 'notification_failed',
        message: 'wa down',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ retryId: 'dr_def', userId: 'user_123' }),
        'Failed to notify user about exhausted message retry'
      );
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

    it('returns internal_error when successful message retry cleanup fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'delete failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete retry entry after successful message delivery',
      });
      expect(mockLogLineRepo.storeBatch).not.toHaveBeenCalled();
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

    it('returns internal_error when retryable message failure cannot update retry metadata', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(err({ code: 'worker_unavailable', message: 'connection refused' }));
      mockDispatchRetryRepo.update.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'retry update failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to update retry entry',
      });
      expect(mockDispatchRetryRepo.delete).not.toHaveBeenCalled();
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

    it('returns internal_error when malformed task-message retry cleanup fails', async () => {
      const entryMissingFields = {
        ...sampleTaskMessageRetry,
        userId: undefined,
        taskId: undefined,
        message: undefined,
      };
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(entryMissingFields));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'delete failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete malformed task-message retry entry',
      });
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

    it('returns internal_error when task-message settings failure cannot update retry metadata', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(err({ code: 'internal_error', message: 'db error' }));
      mockDispatchRetryRepo.update.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'retry update failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to update retry entry',
      });
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

    it('returns internal_error when no-worker task-message retry metadata cannot be updated', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [{ ...workerConfig, enabled: false }] }));
      mockDispatchRetryRepo.update.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'retry update failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to update retry entry',
      });
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

    it('returns internal_error when permanent message failure cleanup fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(err({ code: 'dispatch_failed', message: 'bad payload' }));
      mockDispatchRetryRepo.delete.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'delete failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete retry entry after permanent message failure',
      });
    });

    it('creates new task when message retry fails with stale task error (worker_error + Task not found)', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
        err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('stale_task_fallback');
      expect(result.value.taskId).toBe('task_fallback_new');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
      expect(mockCreateTaskForPRFn).toHaveBeenCalledWith(expect.objectContaining({
        repository: 'intexuraos/test-repo',
        prNumber: 10,
        senderLogin: 'testuser',
        comment: 'please also fix tests',
      }));
    });

    it('returns internal_error and does not create fallback task when stale retry cleanup fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
        err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
      );
      mockDispatchRetryRepo.delete.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'delete failed',
      }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to delete retry entry before stale task fallback',
      });
      expect(mockCreateTaskForPRFn).not.toHaveBeenCalled();
    });

    it('creates new task when message retry fails with task_not_found code', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
        err({ code: 'task_not_found', message: 'Task task_xyz not found' })
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('stale_task_fallback');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
    });

    it('creates new task with prTitle and baseBranch when message retry fails with stale task error', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetryWithContext));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
        err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('stale_task_fallback');
      expect(mockCreateTaskForPRFn).toHaveBeenCalledWith(expect.objectContaining({
        prTitle: 'Fix the login bug',
        baseBranch: 'feature/login',
      }));
    });

    it('passes empty string when message is null', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetryNullMessage));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
        err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
      );

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('stale_task_fallback');
      expect(mockCreateTaskForPRFn).toHaveBeenCalledWith(expect.objectContaining({
        comment: '',
      }));
    });

    it('returns failed when stale task fallback createTaskForPRFn fails', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
        err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
      );
      mockCreateTaskForPRFn.mockResolvedValue(err({ code: 'internal_error', message: 'Linear issue creation failed' }));

      const result = await drainRetryQueue(buildDeps());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
    });

    it('falls through to permanent failure when stale but no createTaskForPRFn configured', async () => {
      mockDispatchRetryRepo.findOldest.mockResolvedValue(ok(sampleTaskMessageRetry));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [workerConfig] }));
      mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(
        err({ code: 'worker_error', message: 'Worker returned HTTP 404: Task not found' })
      );

      // Build deps WITHOUT createTaskForPRFn
      const depsWithoutFallback: Omit<DrainRetryQueueDeps, 'createTaskForPRFn'> = {
        logger: mockLogger,
        dispatchRetryRepo: mockDispatchRetryRepo as unknown as DrainRetryQueueDeps['dispatchRetryRepo'],
        codeTaskRepo: mockCodeTaskRepo as unknown as DrainRetryQueueDeps['codeTaskRepo'],
        taskDispatcher: mockTaskDispatcher as unknown as DrainRetryQueueDeps['taskDispatcher'],
        linearAgentClient: mockLinearAgentClient as unknown as DrainRetryQueueDeps['linearAgentClient'],
        whatsappNotifier: mockWhatsappNotifier as unknown as DrainRetryQueueDeps['whatsappNotifier'],
        workerSettingsRepo: mockWorkerSettingsRepo as unknown as DrainRetryQueueDeps['workerSettingsRepo'],
        logLineRepo: mockLogLineRepo as unknown as DrainRetryQueueDeps['logLineRepo'],
      };

      const result = await drainRetryQueue(depsWithoutFallback as DrainRetryQueueDeps);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.action).toBe('failed');
      expect(mockDispatchRetryRepo.delete).toHaveBeenCalledWith('dr_def');
    });
  });
});
