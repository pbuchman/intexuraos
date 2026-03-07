/**
 * Tests for processCodeAction use case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../../domain/services/taskDispatcher.js';
import type { LinearIssueService } from '../../../domain/services/linearIssueService.js';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';
import type { Logger } from 'pino';
import type { MetricsClient } from '../../../infra/metrics.js';
import { processCodeAction } from '../../../domain/usecases/processCodeAction.js';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';

describe('processCodeAction', () => {
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let linearIssueService: LinearIssueService;
  let whatsappNotifier: WhatsAppNotifier;
  let metricsClient: MetricsClient;
  let workerSettingsRepo: WorkerSettingsRepository;

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
      countQueued: vi.fn(),
      findPlannedTaskByLinearIssue: vi.fn().mockResolvedValue(ok(null)),
    } as unknown as CodeTaskRepository;

    taskDispatcher = {
      dispatch: vi.fn(),
    } as unknown as TaskDispatcherService;

    linearIssueService = {
      ensureIssueExists: vi.fn().mockResolvedValue({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Test Issue',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      }),
    } as unknown as LinearIssueService;

    whatsappNotifier = {
      notifyTaskComplete: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskFailed: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskStarted: vi.fn().mockResolvedValue(ok(undefined)),
      notifyTaskQueued: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as WhatsAppNotifier;

    metricsClient = {
      incrementTasksSubmitted: vi.fn().mockResolvedValue(undefined),
      incrementTasksCompleted: vi.fn().mockResolvedValue(undefined),
      recordTaskDuration: vi.fn().mockResolvedValue(undefined),
      setActiveTasks: vi.fn().mockResolvedValue(undefined),
      recordCost: vi.fn().mockResolvedValue(undefined),
    } as unknown as MetricsClient;

    workerSettingsRepo = {
      getSettings: vi.fn().mockResolvedValue(ok({
        userId: 'user-789',
        workers: [
          {
            name: 'home-mac',
            url: 'https://cc-mac.intexuraos.cloud',
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-dispatch-secret',
            enabled: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      getWorkerByName: vi.fn(),
      addWorker: vi.fn(),
      updateWorker: vi.fn(),
      deleteWorker: vi.fn(),
      reorderWorkers: vi.fn(),
      updateTestResult: vi.fn(),
    } as unknown as WorkerSettingsRepository;
  });

  it('returns internal_error for non-duplication repository errors', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Firestore unavailable' })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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

  it('returns duplicate_prompt for DUPLICATE_PROMPT errors', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({
        code: 'DUPLICATE_PROMPT',
        message: 'Duplicate prompt within 5 minutes',
        existingTaskId: 'existing-task-prompt',
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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
      expect(result.error.code).toBe('duplicate_prompt');
      expect(result.error.existingTaskId).toBe('existing-task-prompt');
    }
  });

  it('returns active_task_exists for ACTIVE_TASK_EXISTS errors', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({
        code: 'ACTIVE_TASK_EXISTS',
        message: 'Active task exists for Linear issue',
        existingTaskId: 'existing-task-active',
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
        linearIssueId: 'INT-500',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('active_task_exists');
      expect(result.error.existingTaskId).toBe('existing-task-active');
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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

    // Verify agentType is 'design' when linear issue has no 'code-task' label
    // (linearIssueService mock returns linearIssueLabels: [] — no code-task label)
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'planning',
        linearIssueId: 'INT-123',
      })
    );

    // Verify worker location and cancel nonce were set
    expect(codeTaskRepo.update).toHaveBeenCalledWith('new-task-123', {
      workerLocation: 'mac',
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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

    // Verify task was updated with error and failed status
    expect(codeTaskRepo.update).toHaveBeenCalledWith('new-task-123', {
      status: 'failed',
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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

  it('persists only linearIssueId on the created task', async () => {
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-305',
      linearIssueTitle: 'Fix the login bug',
      linearIssueLabels: ['code-task'],
      hasChildren: false,
      linearFallback: false,
      linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-305',
    });
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

    await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
        linearIssueId: 'INT-305',
      }
    );

    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueId: 'INT-305',
        agentType: 'execution',
      })
    );
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        linearIssueTitle: expect.anything(),
      })
    );
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        linearIssueUrl: expect.anything(),
      })
    );
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        linearIssueLabels: expect.anything(),
      })
    );
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        linearFallback: expect.anything(),
      })
    );
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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

  it('sets agentType to execution when linear issue has code-task label', async () => {
    // Override linearIssueService to return code-task label
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-123',
      linearIssueTitle: 'Test Issue',
      linearIssueLabels: ['code-task'],
      hasChildren: false,
      linearFallback: false,
    });

    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-execution',
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
        agentType: 'execution',
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
        id: 'new-task-execution',
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
        agentType: 'execution',
        cancelNonce: 'abcd',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(true);

    // Verify agentType is 'execution' when linear issue has 'code-task' label
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'execution',
      })
    );
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
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

  it('stores sanitized prompt when prompt contains secret patterns', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-sanitized',
        userId: 'user-789',
        prompt: 'Use AKIAIOSFODNN7EXAMPLE to access bucket',
        sanitizedPrompt: 'Use [REDACTED_AWS_KEY] to access bucket',
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
      ok({ dispatched: true, workerLocation: 'mac' })
    );

    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({
        id: 'new-task-sanitized',
        userId: 'user-789',
        prompt: 'Use AKIAIOSFODNN7EXAMPLE to access bucket',
        sanitizedPrompt: 'Use [REDACTED_AWS_KEY] to access bucket',
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Use AKIAIOSFODNN7EXAMPLE to access bucket',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(true);

    // Verify codeTaskRepo.create was called with sanitized prompt
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Use AKIAIOSFODNN7EXAMPLE to access bucket',
        sanitizedPrompt: 'Use [REDACTED_AWS_KEY] to access bucket',
      })
    );

    // Verify Linear service received sanitized prompt, not raw prompt
    expect(linearIssueService.ensureIssueExists).toHaveBeenCalledWith(
      expect.objectContaining({
        taskPrompt: 'Use [REDACTED_AWS_KEY] to access bucket',
      })
    );
  });

  it('overrides workerType from label when issue has single worker-type label', async () => {
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-123',
      linearIssueTitle: 'Test Issue',
      linearIssueLabels: ['bug', 'opus'],
      hasChildren: false,
      linearFallback: false,
    });

    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-label',
        userId: 'user-789',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'hash-123',
        workerType: 'opus',
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
      ok({ dispatched: true, workerLocation: 'mac' })
    );

    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({
        id: 'new-task-label',
        userId: 'user-789',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'hash-123',
        workerType: 'opus',
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(true);

    // Label 'opus' should override the request's 'auto' workerType
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workerType: 'opus',
      })
    );
  });

  it('keeps original workerType when no worker-type labels present', async () => {
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-123',
      linearIssueTitle: 'Test Issue',
      linearIssueLabels: ['bug', 'feature'],
      hasChildren: false,
      linearFallback: false,
    });

    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-no-label',
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
      ok({ dispatched: true, workerLocation: 'mac' })
    );

    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({
        id: 'new-task-no-label',
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(true);

    // No worker-type labels → keep request's original 'auto'
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workerType: 'auto',
      })
    );
  });

  it('falls back to original workerType when conflicting worker-type labels present', async () => {
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-123',
      linearIssueTitle: 'Test Issue',
      linearIssueLabels: ['opus', 'glm'],
      hasChildren: false,
      linearFallback: false,
    });

    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-conflict',
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
      ok({ dispatched: true, workerLocation: 'mac' })
    );

    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      ok({
        id: 'new-task-conflict',
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
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(true);

    // Conflicting labels (opus + glm) → fall back to request's 'auto'
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workerType: 'auto',
      })
    );
  });

  it('queues task when dispatch returns at_capacity and queue is not full', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-queued',
        userId: 'user-789',
        prompt: 'Queue test prompt',
        sanitizedPrompt: 'Queue test prompt',
        systemPromptHash: 'hash-123',
        workerType: 'opus',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace-123',
        actionId: 'action-1',
        approvalEventId: 'approval-new-queue',
        status: 'dispatched',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    vi.mocked(taskDispatcher.dispatch).mockResolvedValueOnce(
      err({ code: 'at_capacity', message: 'All workers busy' })
    );
    vi.mocked(codeTaskRepo.countQueued).mockResolvedValueOnce(ok(5));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok({} as unknown as CodeTask));

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-1',
        approvalEventId: 'approval-new-queue',
        userId: 'user-789',
        prompt: 'Queue test prompt',
        workerType: 'opus',
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.codeTaskId).toBe('new-task-queued');
    }
    expect(codeTaskRepo.update).toHaveBeenCalledWith(
      'new-task-queued',
      expect.objectContaining({ status: 'queued', queuedAt: expect.any(Date) })
    );
    expect(whatsappNotifier.notifyTaskQueued).toHaveBeenCalled();
  });

  it('returns internal_error when queue status update fails', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-queue-fail',
        userId: 'user-789',
        prompt: 'Queue fail test',
        sanitizedPrompt: 'Queue fail test',
        systemPromptHash: 'hash-123',
        workerType: 'opus',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace-123',
        actionId: 'action-1',
        approvalEventId: 'approval-queue-fail',
        status: 'dispatched',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    vi.mocked(taskDispatcher.dispatch).mockResolvedValueOnce(
      err({ code: 'at_capacity', message: 'All workers busy' })
    );
    vi.mocked(codeTaskRepo.countQueued).mockResolvedValueOnce(ok(5));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Firestore write failed' })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-1',
        approvalEventId: 'approval-queue-fail',
        userId: 'user-789',
        prompt: 'Queue fail test',
        workerType: 'opus',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('Failed to queue task');
    }
    expect(whatsappNotifier.notifyTaskQueued).not.toHaveBeenCalled();
  });

  it('returns queue_full when dispatch returns at_capacity and queue is full', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-full',
        userId: 'user-789',
        prompt: 'Queue full test prompt',
        sanitizedPrompt: 'Queue full test prompt',
        systemPromptHash: 'hash-123',
        workerType: 'opus',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace-123',
        actionId: 'action-2',
        approvalEventId: 'approval-new-full',
        status: 'dispatched',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    vi.mocked(taskDispatcher.dispatch).mockResolvedValueOnce(
      err({ code: 'at_capacity', message: 'All workers busy' })
    );
    vi.mocked(codeTaskRepo.countQueued).mockResolvedValueOnce(ok(10));
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok({} as unknown as CodeTask));

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-2',
        approvalEventId: 'approval-new-full',
        userId: 'user-789',
        prompt: 'Queue full test prompt',
        workerType: 'opus',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('queue_full');
    }
  });

  it('returns queue_full when countQueued fails (fail-closed)', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      ok({
        id: 'new-task-count-err',
        userId: 'user-789',
        prompt: 'Count error test prompt',
        sanitizedPrompt: 'Count error test prompt',
        systemPromptHash: 'hash-123',
        workerType: 'opus',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace-123',
        actionId: 'action-count-err',
        approvalEventId: 'approval-count-err',
        status: 'dispatched',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    vi.mocked(taskDispatcher.dispatch).mockResolvedValueOnce(
      err({ code: 'at_capacity', message: 'All workers busy' })
    );
    // countQueued fails — should fall back to maxSize (fail-closed), triggering queue_full
    vi.mocked(codeTaskRepo.countQueued).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'DB error' })
    );
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok({} as unknown as CodeTask));

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-count-err',
        approvalEventId: 'approval-count-err',
        userId: 'user-789',
        prompt: 'Count error test prompt',
        workerType: 'opus',
      }
    );

    // Task should be rejected as queue_full (fallback to maxSize >= maxSize)
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('queue_full');
    }
  });

  // ─── Prompt injection sanitization (INT-413) ──────────────────────
  it('returns validation_error for empty prompt', async () => {
    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: '   ',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
  });

  it('returns validation_error for prompt containing a base64 blob', async () => {
    const base64Blob = 'A'.repeat(3500);
    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: base64Blob,
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
  });

  it('passes a normal prompt through sanitization unchanged', async () => {
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Firestore unavailable' })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the login bug',
        workerType: 'auto',
      }
    );

    // Should fail at Firestore, not at validation
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
  });

  describe('planning task back-link (INT-725)', () => {
    function setupExecutionTaskMocks(): void {
      // Linear issue service returns code-task label (execution agent type)
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-200',
        linearIssueTitle: 'Test Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        linearFallback: false,
      });

      // Create returns execution task with linearIssueId
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
        ok({
          id: 'new-exec-task',
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
          agentType: 'execution',
          linearIssueId: 'INT-200',
        } as CodeTask)
      );

      vi.mocked(taskDispatcher.dispatch).mockResolvedValueOnce(
        ok({ dispatched: true, workerLocation: 'mac' })
      );

      // Update for cancel nonce
      vi.mocked(codeTaskRepo.update).mockResolvedValue(
        ok({
          id: 'new-exec-task',
          userId: 'user-789',
          prompt: 'Fix the bug',
          sanitizedPrompt: 'Fix the bug',
          systemPromptHash: 'hash-123',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace-123',
          status: 'dispatched',
          callbackReceived: false,
          dedupKey: 'dedup-key-123',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          cancelNonce: 'abcd',
          cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        } as CodeTask)
      );
    }

    it('back-links planning task when execution task is created for same Linear issue', async () => {
      setupExecutionTaskMocks();

      // findPlannedTaskByLinearIssue returns a planning task
      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(
        ok({
          id: 'planning-task-123',
          status: 'planned',
          agentType: 'planning',
          linearIssueId: 'INT-200',
        } as CodeTask)
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-200',
        }
      );

      expect(result.ok).toBe(true);

      // Should have called findPlannedTaskByLinearIssue
      expect(codeTaskRepo.findPlannedTaskByLinearIssue).toHaveBeenCalledWith('INT-200');

      // Should have updated planning task with implementationTaskId
      expect(codeTaskRepo.update).toHaveBeenCalledWith(
        'planning-task-123',
        expect.objectContaining({ implementationTaskId: 'new-exec-task' })
      );
    });

    it('does not back-link when no planning task exists', async () => {
      setupExecutionTaskMocks();

      // findPlannedTaskByLinearIssue returns null
      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(ok(null));

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-200',
        }
      );

      expect(result.ok).toBe(true);

      // Should NOT have updated any planning task with implementationTaskId
      const updateCalls = vi.mocked(codeTaskRepo.update).mock.calls;
      const backLinkCalls = updateCalls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>)['implementationTaskId'] !== undefined
      );
      expect(backLinkCalls).toHaveLength(0);
    });

    it('succeeds even when back-link findPlannedTaskByLinearIssue fails (best-effort)', async () => {
      setupExecutionTaskMocks();

      // findPlannedTaskByLinearIssue fails
      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'DB error' })
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-200',
        }
      );

      // Should still succeed
      expect(result.ok).toBe(true);
    });

    it('succeeds even when back-link update fails (best-effort)', async () => {
      setupExecutionTaskMocks();

      // findPlannedTaskByLinearIssue returns a planning task
      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(
        ok({
          id: 'planning-task-123',
          status: 'planned',
          agentType: 'planning',
          linearIssueId: 'INT-200',
        } as CodeTask)
      );

      // Override update: first call (back-link) fails, second call (cancel nonce) succeeds
      vi.mocked(codeTaskRepo.update)
        .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Update failed' }))
        .mockResolvedValueOnce(ok({
          id: 'new-exec-task',
          userId: 'user-789',
          prompt: 'Fix the bug',
          sanitizedPrompt: 'Fix the bug',
          systemPromptHash: 'hash-123',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace-123',
          status: 'dispatched',
          callbackReceived: false,
          dedupKey: 'dedup-key-123',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          cancelNonce: 'abcd',
          cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        } as CodeTask));

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-200',
        }
      );

      // Should still succeed despite back-link failure
      expect(result.ok).toBe(true);

      // Should have logged warning
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ planningTaskId: 'planning-task-123', executionTaskId: 'new-exec-task' }),
        'Failed to back-link planning task to execution task'
      );
    });

    it('does not attempt back-link for planning tasks', async () => {
      // Default linearIssueService returns no code-task label → planning agent type
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
        ok({
          id: 'new-planning-task',
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
          agentType: 'planning',
          linearIssueId: 'INT-200',
        } as CodeTask)
      );

      vi.mocked(taskDispatcher.dispatch).mockResolvedValueOnce(
        ok({ dispatched: true, workerLocation: 'mac' })
      );

      vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
        ok({
          id: 'new-planning-task',
          userId: 'user-789',
          prompt: 'Fix the bug',
          sanitizedPrompt: 'Fix the bug',
          systemPromptHash: 'hash-123',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace-123',
          status: 'dispatched',
          callbackReceived: false,
          dedupKey: 'dedup-key-123',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          cancelNonce: 'abcd',
          cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        } as CodeTask)
      );

      await processCodeAction(
        { logger, codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret', serviceUrl: 'https://test.example.com' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-200',
        }
      );

      // Should NOT have called findPlannedTaskByLinearIssue for planning tasks
      expect(codeTaskRepo.findPlannedTaskByLinearIssue).not.toHaveBeenCalled();
    });
  });
});
