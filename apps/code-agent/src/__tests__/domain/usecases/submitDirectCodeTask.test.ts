import { Timestamp } from '@google-cloud/firestore';
import { err, ok, type Logger } from '@intexuraos/common-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { CodeTaskRepository, CreateTaskInput } from '../../../domain/repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';
import type { LinearIssueService } from '../../../domain/services/linearIssueService.js';
import type { MetricsClient } from '../../../domain/services/metrics.js';
import type { TaskEnqueueService } from '../../../domain/services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';
import { backLinkPlanningTask } from '../../../domain/usecases/backLinkPlanningTask.js';
import { submitDirectCodeTask, type SubmitDirectCodeTaskDeps } from '../../../domain/usecases/submitDirectCodeTask.js';

function createTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-created',
    userId: 'user-1',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'Fix the bug',
    systemPromptHash: 'system-prompt-hash-v1',
    workerType: 'auto',
    workerLocation: 'home-mac',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-1',
    status: 'queued',
    callbackReceived: false,
    dedupKey: 'dedup-key',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    agentType: 'planning',
    ...overrides,
  } as CodeTask;
}

function createDeps(): {
  deps: SubmitDirectCodeTaskDeps;
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskEnqueueService: TaskEnqueueService;
  linearIssueService: LinearIssueService;
  linearAgentClient: LinearAgentClient;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
} {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;

  const codeTaskRepo = {
    create: vi.fn(async (input: CreateTaskInput) => {
      const taskOverrides: Partial<CodeTask> = {
        id: input.id ?? 'task-created',
        prompt: input.prompt,
        sanitizedPrompt: input.sanitizedPrompt,
        workerType: input.workerType,
        workerLocation: input.workerLocation,
        repository: input.repository,
        baseBranch: input.baseBranch,
        traceId: input.traceId,
        agentType: input.agentType ?? 'planning',
        status: input.initialStatus ?? 'queued',
      };
      if (input.linearIssueId !== undefined) {
        taskOverrides.linearIssueId = input.linearIssueId;
      }
      return ok(createTask(taskOverrides));
    }),
    update: vi.fn(async (taskId: string, input: Partial<CodeTask>) => ok(createTask({ id: taskId, ...input }))),
    findPlannedTaskByLinearIssue: vi.fn(async () => ok(null)),
    deleteTask: vi.fn(async () => ok(undefined)),
  } as unknown as CodeTaskRepository;

  const taskEnqueueService = {
    enqueue: vi.fn(async ({ taskId }: { taskId: string }) => ok({ taskId, queuePosition: 1 })),
    enqueueMany: vi.fn(async ({ taskIds }: { taskIds: string[] }) =>
      ok(taskIds.map((taskId, index) => ({ taskId, queuePosition: index + 1 })))
    ),
  } as unknown as TaskEnqueueService;

  const linearIssueService = {
    ensureIssueExists: vi.fn(async () => ({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Fix the bug',
      linearIssueLabels: [],
      hasChildren: false,
      linearFallback: false,
    })),
  } as unknown as LinearIssueService;

  const linearAgentClient = {
    validateIssue: vi.fn(),
    fetchDirectChildrenLive: vi.fn(),
  } as unknown as LinearAgentClient;

  const whatsappNotifier = {} as WhatsAppNotifier;

  const metricsClient = {
    incrementTasksSubmitted: vi.fn(async () => undefined),
  } as unknown as MetricsClient;

  const workerSettingsRepo = {
    getSettings: vi.fn(async () =>
      ok({
        userId: 'user-1',
        workers: [
          {
            name: 'home-mac',
            url: 'https://worker.example.com',
            cfAccessClientId: 'client-id',
            cfAccessClientSecret: 'client-secret',
            dispatchSigningSecret: 'dispatch-secret',
            enabled: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ),
  } as unknown as WorkerSettingsRepository;

  return {
    deps: {
      logger,
      codeTaskRepo,
      taskEnqueueService,
      linearIssueService,
      linearAgentClient,
      whatsappNotifier,
      metricsClient,
      workerSettingsRepo,
      orchestratorSecret: 'orchestrator-secret',
    },
    logger,
    codeTaskRepo,
    taskEnqueueService,
    linearIssueService,
    linearAgentClient,
    metricsClient,
    workerSettingsRepo,
  };
}

async function submit(
  deps: SubmitDirectCodeTaskDeps,
  overrides: Partial<Parameters<typeof submitDirectCodeTask>[1]> = {}
): ReturnType<typeof submitDirectCodeTask> {
  return await submitDirectCodeTask(deps, {
    userId: 'user-1',
    prompt: 'Fix the bug',
    workerType: 'auto',
    ...overrides,
  });
}

describe('submitDirectCodeTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns internal_error when worker settings cannot be fetched', async () => {
    const { deps, workerSettingsRepo, logger } = createDeps();
    vi.mocked(workerSettingsRepo.getSettings).mockResolvedValueOnce(
      err({ code: 'internal_error', message: 'Firestore unavailable' })
    );

    const result = await submit(deps);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'internal_error',
        message: 'Failed to fetch worker settings',
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      { userId: 'user-1', error: { code: 'internal_error', message: 'Firestore unavailable' } },
      'Failed to fetch worker settings'
    );
  });

  it('creates and enqueues a direct planning task with default source metrics', async () => {
    const { deps, codeTaskRepo, taskEnqueueService, metricsClient } = createDeps();

    const result = await submit(deps);

    expect(result.ok).toBe(true);
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sanitizedPrompt: 'Fix the bug',
        workerType: 'auto',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        linearIssueId: 'INT-1',
        agentType: 'planning',
      })
    );
    expect(taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: expect.stringMatching(/^task_/),
      userId: 'user-1',
    });
    expect(metricsClient.incrementTasksSubmitted).toHaveBeenCalledWith('auto', 'web');
  });

  it('uses code-task labels to submit execution tasks when taskMode is omitted', async () => {
    const { deps, linearIssueService, codeTaskRepo } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Fix the bug',
      linearIssueLabels: ['code-task'],
      hasChildren: false,
      linearFallback: false,
    });

    const result = await submit(deps, { linearIssueId: 'INT-1' });

    expect(result.ok).toBe(true);
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'execution',
      })
    );
  });

  it('uses user default planning worker type and explicit source when request worker type is auto', async () => {
    const { deps, workerSettingsRepo, codeTaskRepo, metricsClient } = createDeps();
    vi.mocked(workerSettingsRepo.getSettings).mockResolvedValueOnce(
      ok({
        userId: 'user-1',
        workers: [
          {
            name: 'home-mac',
            url: 'https://worker.example.com',
            cfAccessClientId: 'client-id',
            cfAccessClientSecret: 'client-secret',
            dispatchSigningSecret: 'dispatch-secret',
            enabled: true,
          },
        ],
        defaultPlanningWorkerType: 'glm',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    const result = await submit(deps, { source: 'whatsapp' });

    expect(result.ok).toBe(true);
    expect(codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({ workerType: 'glm' }));
    expect(metricsClient.incrementTasksSubmitted).toHaveBeenCalledWith('glm', 'whatsapp');
  });

  it('uses user default execution worker type when taskMode resolves to execution and request worker type is auto', async () => {
    const { deps, workerSettingsRepo, codeTaskRepo } = createDeps();
    vi.mocked(workerSettingsRepo.getSettings).mockResolvedValueOnce(
      ok({
        userId: 'user-1',
        workers: [
          {
            name: 'home-mac',
            url: 'https://worker.example.com',
            cfAccessClientId: 'client-id',
            cfAccessClientSecret: 'client-secret',
            dispatchSigningSecret: 'dispatch-secret',
            enabled: true,
          },
        ],
        defaultExecutionWorkerType: 'codex',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    const result = await submit(deps, { taskMode: 'execution' });

    expect(result.ok).toBe(true);
    expect(codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'execution',
        workerType: 'codex',
      })
    );
  });

  it('returns internal_error when a user-provided Linear issue cannot be validated', async () => {
    const { deps, linearIssueService } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueTitle: 'Fallback task',
      linearIssueLabels: [],
      hasChildren: false,
      linearFallback: true,
    });

    const result = await submit(deps, { linearIssueId: 'INT-404' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toContain('INT-404');
    }
  });

  it('maps repository duplicate and active-task errors from normal task creation', async () => {
    const { deps, codeTaskRepo } = createDeps();
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'ACTIVE_TASK_EXISTS', message: 'Active task exists', existingTaskId: 'task-existing' })
    );

    const result = await submit(deps);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'active_task_exists',
        message: 'Active task exists',
        existingTaskId: 'task-existing',
      },
    });
  });

  it('maps non-dedup repository errors from normal task creation', async () => {
    const { deps, codeTaskRepo } = createDeps();
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Write failed' })
    );

    const result = await submit(deps);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'internal_error',
        message: 'Write failed',
      },
    });
  });

  it.each([
    [{ code: 'queue_full' as const, message: 'Queue is full' }, 'queue_full'],
    [{ code: 'internal_error' as const, message: 'Queue write failed' }, 'internal_error'],
  ])('maps enqueue errors from normal direct submission', async (enqueueError, expectedCode) => {
    const { deps, taskEnqueueService } = createDeps();
    vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(err(enqueueError));

    const result = await submit(deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(expectedCode);
      expect(result.error.message).toBe(enqueueError.message);
    }
  });

  it('maps parent creation duplicate errors before fan-out', async () => {
    const { deps, linearIssueService, codeTaskRepo } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'DUPLICATE_PROMPT', message: 'Duplicate prompt', existingTaskId: 'task-existing' })
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'duplicate_prompt',
        message: 'Duplicate prompt',
        existingTaskId: 'task-existing',
      },
    });
  });

  it('maps parent creation active-task errors before fan-out', async () => {
    const { deps, linearIssueService, codeTaskRepo } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'ACTIVE_TASK_EXISTS', message: 'Active task exists', existingTaskId: 'task-existing' })
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'active_task_exists',
        message: 'Active task exists',
        existingTaskId: 'task-existing',
      },
    });
  });

  it('maps parent creation non-dedup errors before fan-out', async () => {
    const { deps, linearIssueService, codeTaskRepo } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Parent create failed' })
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'internal_error',
        message: 'Parent create failed',
      },
    });
  });

  it('falls back to normal enqueue when fan-out cannot validate the parent issue', async () => {
    const { deps, linearIssueService, linearAgentClient, codeTaskRepo, taskEnqueueService } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
      err({ code: 'UNAVAILABLE', message: 'Linear unavailable' })
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result.ok).toBe(true);
    expect(codeTaskRepo.update).toHaveBeenCalledWith(expect.stringMatching(/^task_/), { status: 'queued' });
    expect(taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: expect.stringMatching(/^task_/),
      userId: 'user-1',
    });
  });

  it('falls back to normal enqueue when live direct-child fetch fails', async () => {
    const { deps, linearIssueService, linearAgentClient, logger } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
      ok({
        id: 'linear-parent-uuid',
        identifier: 'INT-1',
        title: 'Complex issue',
        url: 'https://linear.app/INT-1',
        labels: ['code-task'],
        childCount: 1,
        parentId: null,
      })
    );
    vi.mocked(linearAgentClient.fetchDirectChildrenLive).mockResolvedValueOnce(
      err({ code: 'UNAVAILABLE', message: 'Children unavailable' })
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result.ok).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueId: 'INT-1',
        error: { code: 'internal_error', message: 'Children unavailable' },
      }),
      'Fan-out failed, falling back to normal dispatch'
    );
  });

  it('falls back to normal enqueue when fan-out finds no qualifying children', async () => {
    const { deps, linearIssueService, linearAgentClient, logger, taskEnqueueService } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
      ok({
        id: 'linear-parent-uuid',
        identifier: 'INT-1',
        title: 'Complex issue',
        url: 'https://linear.app/INT-1',
        labels: ['code-task'],
        childCount: 1,
        parentId: null,
      })
    );
    vi.mocked(linearAgentClient.fetchDirectChildrenLive).mockResolvedValueOnce(
      ok([
        {
          id: 'linear-child-uuid',
          identifier: 'INT-2',
          url: 'https://linear.app/INT-2',
          parentId: 'linear-parent-uuid',
          labels: ['feature'],
          assigneeId: null,
          state: 'Backlog',
        },
      ])
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result.ok).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      { linearIssueId: 'INT-1' },
      'Fan-out found no qualifying children, falling back to normal dispatch'
    );
    expect(taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: expect.stringMatching(/^task_/),
      userId: 'user-1',
    });
  });

  it('returns queue_full when fan-out fallback enqueue is full', async () => {
    const { deps, linearIssueService, linearAgentClient, taskEnqueueService } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
      err({ code: 'UNAVAILABLE', message: 'Linear unavailable' })
    );
    vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
      err({ code: 'queue_full', message: 'Queue full' })
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'queue_full',
        message: 'Queue full',
      },
    });
  });

  it('continues fan-out fallback enqueue when parent status reset fails', async () => {
    const { deps, linearIssueService, linearAgentClient, codeTaskRepo, logger, taskEnqueueService } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
      err({ code: 'UNAVAILABLE', message: 'Linear unavailable' })
    );
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'status reset failed' })
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result.ok).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 'FIRESTORE_ERROR', message: 'status reset failed' } }),
      'Failed to reset parent status to queued before fallback enqueue'
    );
    expect(taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: expect.stringMatching(/^task_/),
      userId: 'user-1',
    });
  });

  it('returns internal_error when fan-out fallback enqueue fails unexpectedly', async () => {
    const { deps, linearIssueService, linearAgentClient, taskEnqueueService } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
      err({ code: 'UNAVAILABLE', message: 'Linear unavailable' })
    );
    vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
      err({ code: 'internal_error', message: 'Queue write failed' })
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'internal_error',
        message: 'Queue write failed',
      },
    });
  });

  it('returns the primary child task when fan-out succeeds and parent cancellation succeeds', async () => {
    const { deps, linearIssueService, linearAgentClient, logger } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
      ok({
        id: 'linear-parent-uuid',
        identifier: 'INT-1',
        title: 'Complex issue',
        url: 'https://linear.app/INT-1',
        labels: ['code-task'],
        childCount: 1,
        parentId: null,
      })
    );
    vi.mocked(linearAgentClient.fetchDirectChildrenLive).mockResolvedValueOnce(
      ok([
        {
          id: 'linear-child-uuid',
          identifier: 'INT-2',
          url: 'https://linear.app/INT-2',
          parentId: 'linear-parent-uuid',
          labels: ['code-task'],
          assigneeId: null,
          state: 'Backlog',
        },
      ])
    );

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.codeTaskId).toMatch(/^task_/);
      expect(result.value.workerLocation).toBe('queued');
    }
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      'Failed to cancel parent task after successful fan-out'
    );
  });

  it('returns the primary child task and logs when parent cancellation fails after successful fan-out', async () => {
    const { deps, linearIssueService, linearAgentClient, codeTaskRepo, logger } = createDeps();
    vi.mocked(linearIssueService.ensureIssueExists).mockResolvedValueOnce({
      linearIssueId: 'INT-1',
      linearIssueTitle: 'Complex issue',
      linearIssueLabels: ['code-task'],
      hasChildren: true,
      linearFallback: false,
    });
    vi.mocked(linearAgentClient.validateIssue).mockResolvedValueOnce(
      ok({
        id: 'linear-parent-uuid',
        identifier: 'INT-1',
        title: 'Complex issue',
        url: 'https://linear.app/INT-1',
        labels: ['code-task'],
        childCount: 1,
        parentId: null,
      })
    );
    vi.mocked(linearAgentClient.fetchDirectChildrenLive).mockResolvedValueOnce(
      ok([
        {
          id: 'linear-child-uuid',
          identifier: 'INT-2',
          url: 'https://linear.app/INT-2',
          parentId: 'linear-parent-uuid',
          labels: ['code-task'],
          assigneeId: null,
          state: 'Backlog',
        },
      ])
    );
    vi.mocked(codeTaskRepo.update)
      .mockResolvedValueOnce(ok(createTask({ id: 'task-parent' })))
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'cancel failed' }));

    const result = await submit(deps, { taskMode: 'execution', linearIssueId: 'INT-1' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.codeTaskId).toMatch(/^task_/);
    }
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 'FIRESTORE_ERROR', message: 'cancel failed' } }),
      'Failed to cancel parent task after successful fan-out'
    );
  });
});

describe('backLinkPlanningTask', () => {
  it('logs and returns when planned-task lookup fails', async () => {
    const { codeTaskRepo, logger } = createDeps();
    vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Lookup failed' })
    );

    await backLinkPlanningTask(codeTaskRepo, logger, createTask({
      id: 'task-exec',
      agentType: 'execution',
      linearIssueId: 'INT-1',
    }));

    expect(logger.warn).toHaveBeenCalledWith(
      { error: { code: 'FIRESTORE_ERROR', message: 'Lookup failed' }, executionTaskId: 'task-exec' },
      'Failed to find planning task for back-link'
    );
  });

  it('back-links a planned task when one exists', async () => {
    const { codeTaskRepo, logger } = createDeps();
    vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(
      ok(createTask({ id: 'task-planning', agentType: 'planning', linearIssueId: 'INT-1' }))
    );

    await backLinkPlanningTask(codeTaskRepo, logger, createTask({
      id: 'task-exec',
      agentType: 'execution',
      linearIssueId: 'INT-1',
    }));

    expect(codeTaskRepo.update).toHaveBeenCalledWith('task-planning', {
      implementationTaskId: 'task-exec',
    });
  });

  it('logs and continues when back-link update fails', async () => {
    const { codeTaskRepo, logger } = createDeps();
    vi.mocked(codeTaskRepo.findPlannedTaskByLinearIssue).mockResolvedValueOnce(
      ok(createTask({ id: 'task-planning', agentType: 'planning', linearIssueId: 'INT-1' }))
    );
    vi.mocked(codeTaskRepo.update).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
    );

    await backLinkPlanningTask(codeTaskRepo, logger, createTask({
      id: 'task-exec',
      agentType: 'execution',
      linearIssueId: 'INT-1',
    }));

    expect(logger.warn).toHaveBeenCalledWith(
      { planningTaskId: 'task-planning', executionTaskId: 'task-exec' },
      'Failed to back-link planning task to execution task'
    );
  });
});
