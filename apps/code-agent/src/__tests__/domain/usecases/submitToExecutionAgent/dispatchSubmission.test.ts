/**
 * Tests for dispatchSubmission — the orchestrator-call / response-handling
 * phase of the submitToExecutionAgent workflow.
 *
 * Covers:
 *  - Orchestrator accepts: returns the new execution task ID.
 *  - Orchestrator rejects (queue_full): error propagated with correct code
 *    and implementationTaskId rolled back.
 *  - Create-failure rollback: implementationTaskId reset to null.
 */

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../../domain/models/codeTask.js';
import {
  dispatchSubmission,
  type DispatchSubmissionDeps,
} from '../../../../domain/usecases/submitToExecutionAgent/dispatchSubmission.js';
import type { PreparedSubmission } from '../../../../domain/usecases/submitToExecutionAgent/prepareSubmission.js';

describe('dispatchSubmission', () => {
  const userId = 'user_123';
  const linearIssueId = 'INT-100';

  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    updateIssueState: ReturnType<typeof vi.fn>;
    addComment: ReturnType<typeof vi.fn>;
  };
  let mockTaskEnqueueService: {
    enqueue: ReturnType<typeof vi.fn>;
  };
  let originalWebAppUrl: string | undefined;

  function makeTask(): CodeTask {
    const now = Timestamp.now();
    return {
      id: 'task_planning',
      userId,
      traceId: 'trace-abc',
      prompt: 'p',
      sanitizedPrompt: 'p',
      systemPromptHash: 'hash123',
      workerType: 'auto',
      workerLocation: 'home-dev',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'planned',
      agentType: 'planning',
      dedupKey: 'd',
      callbackReceived: true,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      linearIssueId,
    };
  }

  function createDeps(): DispatchSubmissionDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as DispatchSubmissionDeps['codeTaskRepo'],
      linearAgentClient: mockLinearAgentClient as unknown as DispatchSubmissionDeps['linearAgentClient'],
      taskEnqueueService: mockTaskEnqueueService as unknown as DispatchSubmissionDeps['taskEnqueueService'],
      orchestratorSecret: 'test-secret',
    };
  }

  function createPrepared(): PreparedSubmission {
    return {
      planningTask: makeTask(),
      userId,
      linearIssueId,
      effectiveWorkerType: 'auto',
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    originalWebAppUrl = process.env['INTEXURAOS_WEB_APP_URL'];
    delete process.env['INTEXURAOS_WEB_APP_URL'];
    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
    mockCodeTaskRepo = {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(ok({})),
    };
    mockLinearAgentClient = {
      updateIssueState: vi.fn().mockResolvedValue(ok({})),
      addComment: vi.fn().mockResolvedValue(ok({})),
    };
    mockTaskEnqueueService = {
      enqueue: vi.fn(),
    };
  });

  afterEach(() => {
    if (originalWebAppUrl === undefined) {
      delete process.env['INTEXURAOS_WEB_APP_URL'];
    } else {
      process.env['INTEXURAOS_WEB_APP_URL'] = originalWebAppUrl;
    }
  });

  it('returns the execution task ID when the orchestrator accepts the enqueue', async () => {
    mockCodeTaskRepo.create.mockImplementation((input: { id: string }) =>
      Promise.resolve(ok({ ...makeTask(), id: input.id, agentType: 'execution' })),
    );
    mockTaskEnqueueService.enqueue.mockResolvedValue(ok({ taskId: 'ignored', queuePosition: 1 }));

    const result = await dispatchSubmission(createDeps(), createPrepared());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.codeTaskId).toMatch(/^task_/);
      expect(result.value.resourceUrl).toBe(
        `https://intexuraos.cloud/#/code-tasks/${result.value.codeTaskId}`
      );
      expect(result.value.implementationOf).toBe('task_planning');
      expect(result.value.workerLocation).toBe('queued');
    }
    expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('dispatches a single execution task for the original issue', async () => {
    mockCodeTaskRepo.create.mockImplementation((input: Partial<CodeTask>) =>
      Promise.resolve(ok({ ...makeTask(), ...input, id: input.id ?? 'task_execution', agentType: 'execution' })),
    );
    mockTaskEnqueueService.enqueue.mockResolvedValue(ok({ taskId: 'ignored', queuePosition: 1 }));

    const result = await dispatchSubmission(createDeps(), createPrepared());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mockCodeTaskRepo.create).toHaveBeenCalledTimes(1);
    expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'execution',
      linearIssueId,
      parentTaskId: 'task_planning',
      followUpReason: 'execution_implement',
    }));
    expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(result.value).not.toHaveProperty('childTaskIds');
  });

  it('uses INTEXURAOS_WEB_APP_URL in the single-task Linear start comment', async () => {
    process.env['INTEXURAOS_WEB_APP_URL'] = 'https://dev.intexuraos.cloud/';
    mockCodeTaskRepo.create.mockImplementation((input: { id: string }) =>
      Promise.resolve(ok({ ...makeTask(), id: input.id, agentType: 'execution' })),
    );
    mockTaskEnqueueService.enqueue.mockResolvedValue(ok({ taskId: 'ignored', queuePosition: 1 }));

    await dispatchSubmission(createDeps(), createPrepared());

    const body = mockLinearAgentClient.addComment.mock.calls[0]?.[0]?.body as string;
    expect(body).toContain('https://dev.intexuraos.cloud/#/code-tasks/task_planning');
    expect(body).toContain('https://dev.intexuraos.cloud/#/code-tasks/task_');
  });

  it('propagates queue_full and rolls back the optimistic lock when the orchestrator rejects', async () => {
    mockCodeTaskRepo.create.mockImplementation((input: { id: string }) =>
      Promise.resolve(ok({ ...makeTask(), id: input.id, agentType: 'execution' })),
    );
    mockTaskEnqueueService.enqueue.mockResolvedValue(
      err({ code: 'queue_full', message: 'queue is full' }),
    );

    const result = await dispatchSubmission(createDeps(), createPrepared());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('queue_full');
    }
    // Two updates expected: the optimistic lock, then the rollback.
    expect(mockCodeTaskRepo.update).toHaveBeenCalledTimes(2);
    expect(mockCodeTaskRepo.update).toHaveBeenLastCalledWith(
      'task_planning',
      expect.objectContaining({ implementationTaskId: null }),
    );
  });

  it('rolls back the optimistic lock when task creation fails', async () => {
    mockCodeTaskRepo.create.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'db down' }),
    );

    const result = await dispatchSubmission(createDeps(), createPrepared());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
    expect(mockCodeTaskRepo.update).toHaveBeenCalledTimes(2);
    expect(mockCodeTaskRepo.update).toHaveBeenLastCalledWith(
      'task_planning',
      expect.objectContaining({ implementationTaskId: null }),
    );
    // Orchestrator should never be called when create fails before dispatch.
    expect(mockTaskEnqueueService.enqueue).not.toHaveBeenCalled();
  });
});
