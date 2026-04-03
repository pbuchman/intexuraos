import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { IssueTreeNode } from '../../../domain/ports/linearAgentClient.js';
import {
  fanOutChildTasks,
  shouldFanOut,
  type FanOutChildTasksDeps,
} from '../../../domain/usecases/fanOutChildTasks.js';

describe('fanOutChildTasks', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
  };
  let mockTaskEnqueueService: {
    enqueue: ReturnType<typeof vi.fn>;
    enqueueMany: ReturnType<typeof vi.fn>;
  };

  const qualifyingChild1: IssueTreeNode = {
    id: 'child-1',
    identifier: 'INT-101',
    url: 'https://linear.app/pbuchman/issue/INT-101',
    parentId: 'parent-uuid-1',
    labels: ['code-task'],
    assigneeId: null,
    state: 'Backlog',
  };
  const qualifyingChild2: IssueTreeNode = {
    id: 'child-2',
    identifier: 'INT-102',
    url: 'https://linear.app/pbuchman/issue/INT-102',
    parentId: 'parent-uuid-1',
    labels: ['backend', 'code-task'],
    assigneeId: null,
    state: 'Backlog',
  };
  const nonQualifyingChild: IssueTreeNode = {
    id: 'child-3',
    identifier: 'INT-103',
    url: 'https://linear.app/pbuchman/issue/INT-103',
    parentId: 'parent-uuid-1',
    labels: ['backend'],
    assigneeId: null,
    state: 'Backlog',
  };

  function createPlanningTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    return {
      id: 'task-planning-1',
      userId: 'user-123',
      traceId: 'trace-123',
      prompt: 'Plan feature',
      sanitizedPrompt: 'Plan feature',
      systemPromptHash: 'hash-123',
      workerType: 'auto',
      workerLocation: 'home-dev',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'planned',
      dedupKey: 'dedup-123',
      callbackReceived: true,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      linearIssueId: 'INT-100',
      agentType: 'planning',
      ...overrides,
    };
  }

  function createDeps(): FanOutChildTasksDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as FanOutChildTasksDeps['codeTaskRepo'],
      taskEnqueueService: mockTaskEnqueueService as unknown as FanOutChildTasksDeps['taskEnqueueService'],
      orchestratorSecret: 'test-orchestrator-secret',
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    mockCodeTaskRepo = {
      create: vi.fn().mockResolvedValue(ok(createPlanningTask({ id: 'task-created' }))),
      update: vi.fn().mockResolvedValue(ok(createPlanningTask({ implementationTaskId: 'task-child-1' }))),
      deleteTask: vi.fn().mockResolvedValue(ok(undefined)),
    };
    mockTaskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'task-created', queuePosition: 1 })),
      enqueueMany: vi.fn().mockResolvedValue(ok([
        { taskId: 'task-child-1', queuePosition: 1 },
        { taskId: 'task-child-2', queuePosition: 2 },
      ])),
    };
  });

  describe('shouldFanOut', () => {
    it('returns true when issue has children and code-task label', () => {
      expect(shouldFanOut(true, ['complex-task', 'code-task'])).toBe(true);
    });

    it('returns false when issue has no children', () => {
      expect(shouldFanOut(false, ['code-task'])).toBe(false);
    });

    it('returns false when issue is missing code-task label', () => {
      expect(shouldFanOut(true, ['backend'])).toBe(false);
    });
  });

  it('creates child execution tasks, links the planning task, and enqueues as a batch', async () => {
    const planningTask = createPlanningTask();
    const createdTaskIds: string[] = [];
    mockCodeTaskRepo.create.mockImplementation(async (input) => {
      createdTaskIds.push(input.id);
      return ok(createPlanningTask({ id: input.id, agentType: 'execution', parentTaskId: planningTask.id }));
    });
    mockTaskEnqueueService.enqueueMany.mockImplementation(async ({ taskIds }) => {
      return ok(taskIds.map((taskId: string, index: number) => ({ taskId, queuePosition: index + 1 })));
    });

    const result = await fanOutChildTasks(createDeps(), {
      planningTask,
      userId: 'user-123',
      childIssues: [qualifyingChild2, nonQualifyingChild, qualifyingChild1],
      workerType: 'sonnet',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.childTaskIds).toEqual(createdTaskIds);
      expect(result.value.primaryChildIssueId).toBe('INT-101');
      expect(result.value.primaryChildTaskId).toBe(createdTaskIds[0]);
    }

    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
      planningTask.id,
      expect.objectContaining({
        implementationTaskId: expect.any(String),
        fanOutChildTaskIds: expect.arrayContaining(createdTaskIds),
      }),
      expect.anything(),
    );
    expect(mockCodeTaskRepo.create).toHaveBeenCalledTimes(2);
    expect(mockCodeTaskRepo.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        linearIssueId: 'INT-101',
        workerType: 'sonnet',
        workerLocation: 'queued',
        parentTaskId: planningTask.id,
        followUpReason: 'execution_implement',
      }),
      expect.anything(),
    );
    expect(mockTaskEnqueueService.enqueueMany).toHaveBeenCalledWith({
      taskIds: createdTaskIds,
      userId: 'user-123',
    });
  });

  it('creates child tasks with independent create calls, not inside a shared transaction', async () => {
    const planningTask = createPlanningTask();
    const createCallOptions: Array<{ transaction?: unknown } | undefined> = [];

    mockCodeTaskRepo.create.mockImplementation(async (input: { id: string }, options?: { transaction?: unknown }) => {
      createCallOptions.push(options);
      return ok(createPlanningTask({ id: input.id, agentType: 'execution', parentTaskId: planningTask.id }));
    });

    const result = await fanOutChildTasks(createDeps(), {
      planningTask,
      userId: 'user-123',
      childIssues: [qualifyingChild1, qualifyingChild2],
      workerType: 'claude-code',
    });

    expect(result.ok).toBe(true);
    // Each create call should NOT receive a transaction option
    for (const opt of createCallOptions) {
      expect(opt?.transaction).toBeUndefined();
    }
  });

  it('uses the planning task id in child prompts when the parent has no linearIssueId', async () => {
    const planningTask = createPlanningTask();
    delete (planningTask as Partial<CodeTask>).linearIssueId;

    const result = await fanOutChildTasks(createDeps(), {
      planningTask,
      userId: 'user-123',
      childIssues: [qualifyingChild1],
      workerType: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: `[Fan-out from ${planningTask.id}] ${qualifyingChild1.identifier}`,
      }),
      expect.anything(),
    );
  });

  it('returns no_qualifying_children when no live children have code-task label', async () => {
    const result = await fanOutChildTasks(createDeps(), {
      planningTask: createPlanningTask(),
      userId: 'user-123',
      childIssues: [nonQualifyingChild],
      workerType: 'auto',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no_qualifying_children');
    }
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
    expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns queue_full and clears planning linkage when batch enqueue fails for capacity', async () => {
    const planningTask = createPlanningTask();
    const createdTaskIds: string[] = [];
    mockCodeTaskRepo.create.mockImplementation(async (input) => {
      createdTaskIds.push(input.id);
      return ok(createPlanningTask({ id: input.id, agentType: 'execution', parentTaskId: planningTask.id }));
    });
    mockTaskEnqueueService.enqueueMany.mockResolvedValue(
      err({ code: 'queue_full', message: 'Queue is full' }),
    );

    const result = await fanOutChildTasks(createDeps(), {
      planningTask,
      userId: 'user-123',
      childIssues: [qualifyingChild1, qualifyingChild2],
      workerType: 'auto',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('queue_full');
    }
    expect(mockCodeTaskRepo.update).toHaveBeenLastCalledWith(
      planningTask.id,
      expect.objectContaining({
        implementationTaskId: null,
        fanOutChildTaskIds: null,
      }),
    );
  });

  it('falls back to per-task enqueue when batch enqueue is unavailable', async () => {
    const planningTask = createPlanningTask();
    mockTaskEnqueueService.enqueueMany = undefined as unknown as ReturnType<typeof vi.fn>;

    const result = await fanOutChildTasks(createDeps(), {
      planningTask,
      userId: 'user-123',
      childIssues: [qualifyingChild1],
      workerType: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('returns internal_error when linkage update fails', async () => {
    mockCodeTaskRepo.update.mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'lock failed' }));

    const result = await fanOutChildTasks(createDeps(), {
      planningTask: createPlanningTask(),
      userId: 'user-123',
      childIssues: [qualifyingChild1],
      workerType: 'auto',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'internal_error',
        message: 'Failed to link complex child tasks to planning task',
      });
    }
    expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns internal_error when child task creation fails', async () => {
    mockCodeTaskRepo.create.mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'create failed' }));

    const result = await fanOutChildTasks(createDeps(), {
      planningTask: createPlanningTask(),
      userId: 'user-123',
      childIssues: [qualifyingChild1],
      workerType: 'auto',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'internal_error',
        message: `Failed to create child execution task for ${qualifyingChild1.identifier}`,
      });
    }
  });

  it('deletes created child tasks and clears linkage when child creation fails', async () => {
    const planningTask = createPlanningTask();
    let firstCreatedTaskId = '';
    mockCodeTaskRepo.create
      .mockImplementationOnce(async (input) => {
        firstCreatedTaskId = input.id;
        return ok(createPlanningTask({ id: input.id, agentType: 'execution', parentTaskId: planningTask.id }));
      })
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'create failed' }));

    const result = await fanOutChildTasks(createDeps(), {
      planningTask,
      userId: 'user-123',
      childIssues: [qualifyingChild1, qualifyingChild2],
      workerType: 'auto',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'internal_error',
        message: `Failed to create child execution task for ${qualifyingChild2.identifier}`,
      });
    }
    expect(mockCodeTaskRepo.deleteTask).toHaveBeenCalledWith(firstCreatedTaskId, 'user-123');
    expect(mockCodeTaskRepo.update).toHaveBeenLastCalledWith(
      planningTask.id,
      expect.objectContaining({
        implementationTaskId: null,
        fanOutChildTaskIds: null,
      }),
    );
  });

  it('logs a warning and succeeds when batch enqueue degrades with internal_error', async () => {
    mockTaskEnqueueService.enqueueMany.mockResolvedValueOnce(
      err({ code: 'internal_error', message: 'queue service degraded' }),
    );

    const result = await fanOutChildTasks(createDeps(), {
      planningTask: createPlanningTask(),
      userId: 'user-123',
      childIssues: [qualifyingChild1],
      workerType: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskIds: expect.arrayContaining([expect.stringMatching(/^task_/)]),
        error: { code: 'internal_error', message: 'queue service degraded' },
      }),
      'Fan-out: batch enqueue degraded, tasks remain queued without queuedAt stamps',
    );
  });

  it('returns queue_full and clears linkage when per-task enqueue hits capacity', async () => {
    const planningTask = createPlanningTask();
    mockTaskEnqueueService.enqueueMany = undefined as unknown as ReturnType<typeof vi.fn>;
    mockTaskEnqueueService.enqueue.mockResolvedValueOnce(
      err({ code: 'queue_full', message: 'Queue is full' }),
    );

    const result = await fanOutChildTasks(createDeps(), {
      planningTask,
      userId: 'user-123',
      childIssues: [qualifyingChild1],
      workerType: 'auto',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'queue_full', message: 'Queue is full' });
    }
    expect(mockCodeTaskRepo.update).toHaveBeenLastCalledWith(
      planningTask.id,
      expect.objectContaining({
        implementationTaskId: null,
        fanOutChildTaskIds: null,
      }),
    );
  });

  it('logs a warning and succeeds when per-task enqueue fails without queue_full', async () => {
    mockTaskEnqueueService.enqueueMany = undefined as unknown as ReturnType<typeof vi.fn>;
    mockTaskEnqueueService.enqueue.mockResolvedValueOnce(
      err({ code: 'internal_error', message: 'enqueue degraded' }),
    );

    const result = await fanOutChildTasks(createDeps(), {
      planningTask: createPlanningTask(),
      userId: 'user-123',
      childIssues: [qualifyingChild1],
      workerType: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        childTaskId: expect.stringMatching(/^task_/),
        error: { code: 'internal_error', message: 'enqueue degraded' },
      }),
      'Fan-out: failed to enqueue child task (task remains queued)',
    );
  });
});
