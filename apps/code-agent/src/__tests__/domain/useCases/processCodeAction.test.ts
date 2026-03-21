/**
 * Tests for processCodeAction use case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { TaskEnqueueService } from '../../../domain/services/taskEnqueueService.js';
import type { LinearIssueService } from '../../../domain/services/linearIssueService.js';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';
import type { Logger } from 'pino';
import type { MetricsClient } from '../../../infra/metrics.js';
import { processCodeAction } from '../../../domain/usecases/processCodeAction.js';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';

describe('processCodeAction', () => {
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskEnqueueService: TaskEnqueueService;
  let linearIssueService: LinearIssueService;
  let linearAgentClient: LinearAgentClient;
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

    taskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 0 })),
    } as unknown as TaskEnqueueService;

    linearIssueService = {
      ensureIssueExists: vi.fn().mockResolvedValue({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Test Issue',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      }),
    } as unknown as LinearIssueService;

    linearAgentClient = {
      validateIssue: vi.fn(),
      fetchIssueTree: vi.fn(),
      createIssue: vi.fn(),
      updateIssueState: vi.fn(),
      generateTitle: vi.fn(),
      addComment: vi.fn(),
      updateIssueMetadata: vi.fn(),
      fetchIssueForDisplay: vi.fn(),
      fetchIssuesForDisplay: vi.fn(),
    } as unknown as LinearAgentClient;

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
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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

  it('successfully creates task and enqueues for dispatch', async () => {
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      expect(result.value.workerLocation).toBe('queued');
    }

    // Verify agentType is 'planning' when linear issue has no 'code-task' label
    // (linearIssueService mock returns linearIssueLabels: [] — no code-task label)
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'planning',
        linearIssueId: 'INT-123',
      })
    );

    // Verify enqueue was called
    expect(taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: 'new-task-123',
      userId: 'user-789',
    });
  });

  it('returns internal_error when enqueue service returns internal_error', async () => {
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
      err({
        code: 'internal_error',
        message: 'Failed to enqueue task',
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      expect(result.error.message).toBe('Failed to enqueue task');
    }
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-305',
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      expect(result.value.workerLocation).toBe('queued');
    }
  });

  it('persists only linearIssueId on the created task', async () => {
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-305',
      linearIssueTitle: 'Fix the login bug',
      linearIssueLabels: ['code-task'],
      hasChildren: false,
      linearFallback: false,
      linearIssueUrl: 'https://linear.app/pbuchman/issue/INT-305',
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-305',
      })
    );

    await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      expect(result.value.workerLocation).toBe('queued');
    }
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        agentType: 'execution',
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
      {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-789',
        prompt: 'Fix the bug',
        workerType: 'auto',
      }
    );

    expect(result.ok).toBe(true);

    // Conflicting labels (opus + glm-5) → fall back to request's 'auto'
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workerType: 'auto',
      })
    );
  });

  it('returns queue_full when enqueue service returns queue_full', async () => {
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
        status: 'queued',
        callbackReceived: false,
        dedupKey: 'dedup-key-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
    );

    vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
      err({ code: 'queue_full', message: 'Queue is full' })
    );

    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      expect(result.error.message).toBe('Queue is full');
    }
  });

  // ─── Worker Settings Error Path Tests (v8 ignore blocks 1-3) ─────
  describe('worker settings error paths', () => {
    it('returns internal_error when getSettings fails', async () => {
      const failingWorkerSettingsRepo = {
        getSettings: vi.fn().mockResolvedValue(
          err({ code: 'internal_error' as const, message: 'Firestore unavailable' })
        ),
        getWorkerByName: vi.fn(),
        addWorker: vi.fn(),
        updateWorker: vi.fn(),
        deleteWorker: vi.fn(),
        reorderWorkers: vi.fn(),
        updateTestResult: vi.fn(),
      } as unknown as WorkerSettingsRepository;

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo: failingWorkerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        expect(result.error.message).toBe('Failed to fetch worker settings');
      }
      expect(logger.error).toHaveBeenCalledWith(
        { userId: 'user-789', error: { code: 'internal_error', message: 'Firestore unavailable' } },
        'Failed to fetch worker settings'
      );
    });

    it('returns worker_not_configured when settings is null', async () => {
      const nullSettingsWorkerSettingsRepo = {
        getSettings: vi.fn().mockResolvedValue(ok(null)),
        getWorkerByName: vi.fn(),
        addWorker: vi.fn(),
        updateWorker: vi.fn(),
        deleteWorker: vi.fn(),
        reorderWorkers: vi.fn(),
        updateTestResult: vi.fn(),
      } as unknown as WorkerSettingsRepository;

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo: nullSettingsWorkerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        expect(result.error.code).toBe('worker_not_configured');
        expect(result.error.message).toBe('Please configure your workers in Settings before submitting code tasks');
      }
      expect(logger.warn).toHaveBeenCalledWith(
        { userId: 'user-789' },
        'User has no workers configured'
      );
    });

    it('returns worker_not_configured when all workers are disabled', async () => {
      const disabledWorkersRepo = {
        getSettings: vi.fn().mockResolvedValue(
          ok({
            userId: 'user-789',
            workers: [
              {
                name: 'home-mac',
                url: 'https://cc-mac.intexuraos.cloud',
                cfAccessClientId: 'test-client-id',
                cfAccessClientSecret: 'test-client-secret',
                dispatchSigningSecret: 'test-dispatch-secret',
                enabled: false, // All workers disabled
              },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        ),
        getWorkerByName: vi.fn(),
        addWorker: vi.fn(),
        updateWorker: vi.fn(),
        deleteWorker: vi.fn(),
        reorderWorkers: vi.fn(),
        updateTestResult: vi.fn(),
      } as unknown as WorkerSettingsRepository;

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo: disabledWorkersRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        expect(result.error.code).toBe('worker_not_configured');
      }
      expect(logger.warn).toHaveBeenCalledWith(
        { userId: 'user-789' },
        'User has no workers configured'
      );
    });

    it('returns worker_not_configured when workers array is empty', async () => {
      const emptyWorkersRepo = {
        getSettings: vi.fn().mockResolvedValue(
          ok({
            userId: 'user-789',
            workers: [], // Empty array
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        ),
        getWorkerByName: vi.fn(),
        addWorker: vi.fn(),
        updateWorker: vi.fn(),
        deleteWorker: vi.fn(),
        reorderWorkers: vi.fn(),
        updateTestResult: vi.fn(),
      } as unknown as WorkerSettingsRepository;

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo: emptyWorkersRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        expect(result.error.code).toBe('worker_not_configured');
      }
    });
  });

  // ─── Linear Issue Validation Error Path Tests (v8 ignore block 4) ─
  describe('linear issue validation error paths', () => {
    it('returns internal_error when user provides linearIssueId but validation fails (linearFallback: true)', async () => {
      const failingLinearService = {
        ensureIssueExists: vi.fn().mockResolvedValue({
          linearIssueTitle: 'Linked issue INT-100',
          linearFallback: true, // Validation failed, fallback mode
          linearIssueLabels: [],
          hasChildren: false,
        }),
        markInProgress: vi.fn(),
        markInReview: vi.fn(),
      } as unknown as LinearIssueService;

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService: failingLinearService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-100', // User provided issue ID
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toContain('could not be validated');
      }
      expect(logger.error).toHaveBeenCalledWith(
        { linearIssueId: 'INT-100' },
        'User-provided Linear issue could not be validated'
      );
    });
  });

  // ─── Final Linear Issue ID Undefined Test (v8 ignore block 5) ──────
  describe('linear issue id undefined path (v8 ignore block 5)', () => {
    it('does not include linearIssueId in task when ensureIssueExists returns undefined', async () => {
      const fallbackLinearService = {
        ensureIssueExists: vi.fn().mockResolvedValue({
          // linearIssueId is undefined - fallback mode
          linearIssueTitle: 'Fallback Task',
          linearFallback: true,
          linearIssueLabels: [],
          hasChildren: false,
        }),
        markInProgress: vi.fn(),
        markInReview: vi.fn(),
      } as unknown as LinearIssueService;

      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
        ok({
          id: 'new-task-no-issue',
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
          status: 'queued',
          callbackReceived: false,
          dedupKey: 'dedup-key-123',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          // linearIssueId NOT set because finalLinearIssueId was undefined
        })
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService: fallbackLinearService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          // No linearIssueId provided - should trigger the undefined branch
        }
      );

      expect(result.ok).toBe(true);

      // Verify create was called with linearIssueId NOT set (undefined means property is omitted)
      expect(codeTaskRepo.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearIssueId: expect.anything(),
        })
      );
    });
  });

  // ─── Prompt injection sanitization (INT-413) ──────────────────────
  it('returns validation_error for empty prompt', async () => {
    const result = await processCodeAction(
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
      { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
          status: 'queued',
          callbackReceived: false,
          dedupKey: 'dedup-key-123',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          agentType: 'execution',
          linearIssueId: 'INT-200',
        } as CodeTask)
      );

      // Update for back-link (best-effort)
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
          status: 'queued',
          callbackReceived: false,
          dedupKey: 'dedup-key-123',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
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
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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

      // Should have logged warning about find failure
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ executionTaskId: 'new-exec-task' }),
        'Failed to find planning task for back-link'
      );
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

      // Override update: back-link update fails
      vi.mocked(codeTaskRepo.update)
        .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Update failed' }));

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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
          status: 'queued',
          callbackReceived: false,
          dedupKey: 'dedup-key-123',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          agentType: 'planning',
          linearIssueId: 'INT-200',
        } as CodeTask)
      );

      await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
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

    it('succeeds even when findPlannedTaskByLinearIssue throws an exception (best-effort)', async () => {
      setupExecutionTaskMocks();

      // findPlannedTaskByLinearIssue throws an unexpected exception
      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockRejectedValueOnce(
        new Error('Unexpected Firestore connection error')
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-200',
        }
      );

      // Should still succeed despite thrown exception
      expect(result.ok).toBe(true);

      // Should have logged warning about the exception
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ executionTaskId: 'new-exec-task' }),
        'Best-effort back-link to planning task failed'
      );
    });
  });

  describe('fan-out for parent issues with code-task children (INT-962)', () => {
    it('triggers fan-out when hasChildren=true and labels include code-task', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      // Parent task creation succeeds
      const parentTask = {
        id: 'task-parent-123',
        userId: 'user-789',
        prompt: 'Implement all sub-tasks',
        sanitizedPrompt: 'Implement all sub-tasks',
        systemPromptHash: 'system-prompt-hash-v1',
        workerType: 'auto' as const,
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        status: 'queued' as const,
        dedupKey: 'dedup-parent',
        callbackReceived: false,
        traceId: 'trace-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-956',
        agentType: 'execution' as const,
      };
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(ok(parentTask));

      // Mock linearAgentClient for fan-out
      vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
        ok({
          id: 'parent-uuid',
          identifier: 'INT-956',
          title: 'Parent',
          url: 'https://linear.app',
          labels: ['code-task'],
          childCount: 2,
          parentId: null,
        })
      );
      vi.mocked(linearAgentClient.fetchIssueTree).mockResolvedValueOnce(
        ok({
          root: { id: 'parent-uuid', identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          descendants: [
            { id: 'child-uuid-1', identifier: 'INT-957', url: '', parentId: 'parent-uuid', labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          ],
        })
      );

      // Child task creation
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(ok({ ...parentTask, id: 'task-child-1', linearIssueId: 'INT-957' }));
      vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok({ ...parentTask, status: 'implemented' as const }));

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Implement all sub-tasks',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe('task-parent-123');
        expect(result.value.workerLocation).toBe('queued');
      }
    });

    it('falls back to normal dispatch when fan-out returns no_qualifying_children', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      const parentTask = {
        id: 'task-parent-123',
        userId: 'user-789',
        prompt: 'Implement all sub-tasks',
        sanitizedPrompt: 'Implement all sub-tasks',
        systemPromptHash: 'system-prompt-hash-v1',
        workerType: 'auto' as const,
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        status: 'queued' as const,
        dedupKey: 'dedup-parent',
        callbackReceived: false,
        traceId: 'trace-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-956',
        agentType: 'execution' as const,
      };
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(ok(parentTask));

      // Fan-out returns no qualifying children
      vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
        ok({
          id: 'parent-uuid',
          identifier: 'INT-956',
          title: 'Parent',
          url: 'https://linear.app',
          labels: ['code-task'],
          childCount: 1,
          parentId: null,
        })
      );
      vi.mocked(linearAgentClient.fetchIssueTree).mockResolvedValueOnce(
        ok({
          root: { id: 'parent-uuid', identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          descendants: [
            { id: 'child-uuid-1', identifier: 'INT-959', url: '', parentId: 'parent-uuid', labels: ['feature'], assigneeId: null, state: 'Backlog' },
          ],
        })
      );

      // findPlannedTaskByLinearIssue for backLinkPlanningTask
      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(ok(null));

      // INT-977: fallback resets parent status to 'queued' before enqueue
      vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok(parentTask));

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Implement all sub-tasks',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      // Falls back to normal dispatch (task enqueued)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe('task-parent-123');
        expect(result.value.workerLocation).toBe('queued');
      }

      // Verify parent status was reset to 'queued' before enqueue (INT-977)
      expect(codeTaskRepo.update).toHaveBeenCalledWith('task-parent-123', { status: 'queued' });

      // Verify enqueue was called (fallback to normal path)
      expect(taskEnqueueService.enqueue).toHaveBeenCalledWith({
        taskId: 'task-parent-123',
        userId: 'user-789',
      });
    });

    it('logs warning but continues when status reset to queued fails during fallback (INT-977)', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      const parentTask = {
        id: 'task-parent-123',
        userId: 'user-789',
        prompt: 'Implement all sub-tasks',
        sanitizedPrompt: 'Implement all sub-tasks',
        systemPromptHash: 'system-prompt-hash-v1',
        workerType: 'auto' as const,
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        status: 'queued' as const,
        dedupKey: 'dedup-parent',
        callbackReceived: false,
        traceId: 'trace-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-956',
        agentType: 'execution' as const,
      };
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(ok(parentTask));

      // Fan-out returns no qualifying children
      vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
        ok({
          id: 'parent-uuid',
          identifier: 'INT-956',
          title: 'Parent',
          url: 'https://linear.app',
          labels: ['code-task'],
          childCount: 1,
          parentId: null,
        })
      );
      vi.mocked(linearAgentClient.fetchIssueTree).mockResolvedValueOnce(
        ok({
          root: { id: 'parent-uuid', identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          descendants: [
            { id: 'child-uuid-1', identifier: 'INT-959', url: '', parentId: 'parent-uuid', labels: ['feature'], assigneeId: null, state: 'Backlog' },
          ],
        })
      );

      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(ok(null));

      // INT-977: status reset fails
      vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Write failed' })
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Implement all sub-tasks',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      // Still succeeds — status reset failure is best-effort
      expect(result.ok).toBe(true);

      // Warning was logged
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-parent-123' }),
        expect.stringContaining('Failed to reset parent status'),
      );

      // Enqueue was still called
      expect(taskEnqueueService.enqueue).toHaveBeenCalled();
    });

    it('returns queue_full when enqueue fails with queue_full during no_qualifying_children fallback', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      const parentTask = {
        id: 'task-parent-123',
        userId: 'user-789',
        prompt: 'Implement all sub-tasks',
        sanitizedPrompt: 'Implement all sub-tasks',
        systemPromptHash: 'system-prompt-hash-v1',
        workerType: 'auto' as const,
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        status: 'queued' as const,
        dedupKey: 'dedup-parent',
        callbackReceived: false,
        traceId: 'trace-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-956',
        agentType: 'execution' as const,
      };
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(ok(parentTask));

      // Fan-out returns no qualifying children
      vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
        ok({
          id: 'parent-uuid',
          identifier: 'INT-956',
          title: 'Parent',
          url: 'https://linear.app',
          labels: ['code-task'],
          childCount: 1,
          parentId: null,
        })
      );
      vi.mocked(linearAgentClient.fetchIssueTree).mockResolvedValueOnce(
        ok({
          root: { id: 'parent-uuid', identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          descendants: [
            { id: 'child-uuid-1', identifier: 'INT-959', url: '', parentId: 'parent-uuid', labels: ['feature'], assigneeId: null, state: 'Backlog' },
          ],
        })
      );

      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(ok(null));

      // INT-977: fallback resets parent status to 'queued' before enqueue
      vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok(parentTask));

      // Enqueue fails with queue_full
      vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
        err({ code: 'queue_full', message: 'Queue is full' })
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Implement all sub-tasks',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
      }
    });

    it('returns internal_error when enqueue fails with internal_error during no_qualifying_children fallback', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      const parentTask = {
        id: 'task-parent-123',
        userId: 'user-789',
        prompt: 'Implement all sub-tasks',
        sanitizedPrompt: 'Implement all sub-tasks',
        systemPromptHash: 'system-prompt-hash-v1',
        workerType: 'auto' as const,
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        status: 'queued' as const,
        dedupKey: 'dedup-parent',
        callbackReceived: false,
        traceId: 'trace-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-956',
        agentType: 'execution' as const,
      };
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(ok(parentTask));

      vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
        ok({
          id: 'parent-uuid',
          identifier: 'INT-956',
          title: 'Parent',
          url: 'https://linear.app',
          labels: ['code-task'],
          childCount: 1,
          parentId: null,
        })
      );
      vi.mocked(linearAgentClient.fetchIssueTree).mockResolvedValueOnce(
        ok({
          root: { id: 'parent-uuid', identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          descendants: [
            { id: 'child-uuid-1', identifier: 'INT-959', url: '', parentId: 'parent-uuid', labels: ['feature'], assigneeId: null, state: 'Backlog' },
          ],
        })
      );

      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(ok(null));

      // INT-977: fallback resets parent status to 'queued' before enqueue
      vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok(parentTask));

      vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
        err({ code: 'internal_error', message: 'Enqueue internal failure' })
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Implement all sub-tasks',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
    });

    it('falls back to normal dispatch when fan-out returns linear_unavailable', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      const parentTask = {
        id: 'task-parent-123',
        userId: 'user-789',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'system-prompt-hash-v1',
        workerType: 'auto' as const,
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        status: 'queued' as const,
        dedupKey: 'dedup-parent',
        callbackReceived: false,
        traceId: 'trace-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-956',
        agentType: 'execution' as const,
      };
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(ok(parentTask));

      // Fan-out fails (Linear unavailable)
      vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear API is down' })
      );

      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(ok(null));

      // INT-977: fallback resets parent status to 'queued' before enqueue
      vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok(parentTask));

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      // Falls back to normal dispatch
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe('task-parent-123');
      }

      // Verify parent status was reset to 'queued' before enqueue (INT-977)
      expect(codeTaskRepo.update).toHaveBeenCalledWith('task-parent-123', { status: 'queued' });
      expect(taskEnqueueService.enqueue).toHaveBeenCalled();
    });

    it('returns dedup error when parent task creation fails with DUPLICATE_ACTION', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
        err({ code: 'DUPLICATE_ACTION', message: 'Already exists', existingTaskId: 'task-existing' })
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('duplicate_action');
        expect(result.error.existingTaskId).toBe('task-existing');
      }
    });

    it('returns internal_error when parent task creation fails with FIRESTORE_ERROR', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Write failed' })
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
    });

    it('returns queue_full when enqueue fails with queue_full during fan-out fallback', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      const parentTask = {
        id: 'task-parent-123',
        userId: 'user-789',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'system-prompt-hash-v1',
        workerType: 'auto' as const,
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        status: 'queued' as const,
        dedupKey: 'dedup-parent',
        callbackReceived: false,
        traceId: 'trace-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-956',
        agentType: 'execution' as const,
      };
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(ok(parentTask));

      // Fan-out fails
      vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear down' })
      );

      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(ok(null));

      // INT-977: fallback resets parent status to 'queued' before enqueue
      vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok(parentTask));

      // Enqueue fails with queue_full
      vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
        err({ code: 'queue_full', message: 'Queue is full' })
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
      }
    });

    it('returns internal_error when enqueue fails with internal_error during linear_unavailable fallback', async () => {
      vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
        linearIssueId: 'INT-956',
        linearIssueTitle: 'Parent Issue',
        linearIssueLabels: ['code-task'],
        hasChildren: true,
        linearFallback: false,
      });

      const parentTask = {
        id: 'task-parent-123',
        userId: 'user-789',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'system-prompt-hash-v1',
        workerType: 'auto' as const,
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        status: 'queued' as const,
        dedupKey: 'dedup-parent',
        callbackReceived: false,
        traceId: 'trace-123',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        linearIssueId: 'INT-956',
        agentType: 'execution' as const,
      };
      vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(ok(parentTask));

      // Fan-out fails (Linear unavailable)
      vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear API is down' })
      );

      vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(ok(null));

      // INT-977: fallback resets parent status to 'queued' before enqueue
      vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(ok(parentTask));

      // Enqueue fails with internal_error
      vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
        err({ code: 'internal_error', message: 'Enqueue internal failure' })
      );

      const result = await processCodeAction(
        { logger, codeTaskRepo, taskEnqueueService, linearIssueService, linearAgentClient, whatsappNotifier, metricsClient, workerSettingsRepo, orchestratorSecret: 'test-orchestrator-secret' },
        {
          actionId: 'action-123',
          approvalEventId: 'approval-456',
          userId: 'user-789',
          prompt: 'Fix the bug',
          workerType: 'auto',
          linearIssueId: 'INT-956',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
      }
    });
  });
});
