/**
 * Tests for dispatchSubmission — the orchestrator-call / response-handling
 * phase of the submitToExecutionAgent workflow.
 *
 * Covers:
 *  - Orchestrator accepts: returns the new execution task ID.
 *  - Orchestrator rejects (queue_full): error propagated with correct code
 *    and implementationTaskId rolled back.
 *  - Create-failure rollback: implementationTaskId reset to null.
 *  - Complex fan-out: returns primary child task ID and propagates
 *    queue_full / no_qualifying_children errors.
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
import { fanOutChildTasks } from '../../../../domain/usecases/fanOutChildTasks.js';

vi.mock('../../../../domain/usecases/fanOutChildTasks.js', () => ({
  fanOutChildTasks: vi.fn(),
}));

const mockFanOutChildTasks = vi.mocked(fanOutChildTasks);

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
      expect(result.value.implementationOf).toBe('task_planning');
      expect(result.value.workerLocation).toBe('queued');
    }
    expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledTimes(1);
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

  describe('complex fan-out', () => {
    function createComplexPrepared(): PreparedSubmission {
      return {
        planningTask: makeTask(),
        userId,
        linearIssueId,
        effectiveWorkerType: 'auto',
        complex: {
          validatedIssueUuid: 'linear-uuid-parent',
          directChildren: [
            { id: 'c1', identifier: 'INT-101', url: 'u1', parentId: 'linear-uuid-parent', labels: ['code-task'], assigneeId: null, state: 'Backlog' },
            { id: 'c2', identifier: 'INT-102', url: 'u2', parentId: 'linear-uuid-parent', labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          ],
        },
      };
    }

    it('returns the primary child task ID when fan-out succeeds', async () => {
      mockFanOutChildTasks.mockResolvedValue(
        ok({
          childTaskIds: ['task_child_a', 'task_child_b'],
          primaryChildTaskId: 'task_child_a',
          primaryChildIssueId: 'INT-101',
        }),
      );

      const result = await dispatchSubmission(createDeps(), createComplexPrepared());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe('task_child_a');
        expect(result.value.childTaskIds).toEqual(['task_child_a', 'task_child_b']);
        expect(result.value.workerLocation).toBe('queued');
      }
      // create/update/enqueue should NOT be called — fan-out handles persistence.
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
      expect(mockTaskEnqueueService.enqueue).not.toHaveBeenCalled();
    });

    it('uses INTEXURAOS_WEB_APP_URL in complex fan-out Linear comments', async () => {
      process.env['INTEXURAOS_WEB_APP_URL'] = 'https://dev.intexuraos.cloud/';
      mockFanOutChildTasks.mockResolvedValue(
        ok({
          childTaskIds: ['task_child_a', 'task_child_b'],
          primaryChildTaskId: 'task_child_a',
          primaryChildIssueId: 'INT-101',
        }),
      );

      await dispatchSubmission(createDeps(), createComplexPrepared());

      const parentBody = mockLinearAgentClient.addComment.mock.calls[0]?.[0]?.body as string;
      const childBody = mockLinearAgentClient.addComment.mock.calls[1]?.[0]?.body as string;
      expect(parentBody).toContain('https://dev.intexuraos.cloud/#/code-tasks/task_planning');
      expect(parentBody).toContain('https://dev.intexuraos.cloud/#/code-tasks/task_child_a');
      expect(childBody).toContain('https://dev.intexuraos.cloud/#/code-tasks/task_child_a');
    });

    it('propagates queue_full from fan-out', async () => {
      mockFanOutChildTasks.mockResolvedValue(
        err({ code: 'queue_full', message: 'queue full during fan-out' }),
      );

      const result = await dispatchSubmission(createDeps(), createComplexPrepared());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('queue_full');
    });

    it('propagates no_qualifying_children from fan-out', async () => {
      mockFanOutChildTasks.mockResolvedValue(
        err({ code: 'no_qualifying_children', message: 'none had code-task label' }),
      );

      const result = await dispatchSubmission(createDeps(), createComplexPrepared());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('complex_task_no_qualifying_children');
    });

    it('wraps internal_error on unexpected fan-out failure', async () => {
      mockFanOutChildTasks.mockResolvedValue(
        err({ code: 'internal_error', message: 'boom' }),
      );

      const result = await dispatchSubmission(createDeps(), createComplexPrepared());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toMatch(/Fan-out failed/);
      }
    });
  });
});
