import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import { describe, expect, it, vi } from 'vitest';
import type { CodeTask, CodeTaskDispatchStatus } from '../../../domain/models/codeTask.js';
import type { DispatchProblem } from '../../../domain/services/codeTaskDispatchProblems.js';
import { reportDispatchFailure } from '../../../domain/services/codeTaskDispatchFailureReporter.js';
import type { CodeTaskDispatchNotificationRepository } from '../../../domain/repositories/codeTaskDispatchNotificationRepository.js';

function makeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  const now = Timestamp.fromDate(new Date('2026-06-08T10:00:00.000Z'));
  return {
    id: 'task_1',
    userId: 'user_1',
    prompt: 'Review this',
    sanitizedPrompt: 'Review this',
    systemPromptHash: 'hash',
    workerType: 'opus',
    workerLocation: 'pending',
    repository: 'owner/repo',
    baseBranch: 'development',
    traceId: 'trace_1',
    status: 'queued',
    dedupKey: 'dedup',
    callbackReceived: false,
    createdAt: now,
    updatedAt: now,
    prNumber: 123,
    agentType: 'review',
    ...overrides,
  };
}

function makeProblem(): DispatchProblem {
  return {
    reason: 'worker_health_contract_mismatch',
    severity: 'critical',
    message: 'Configured workers responded with an incompatible health contract.',
    remediation: 'Deploy or restart the worker orchestrator, then retry this task.',
    workerNames: ['worker-a'],
    terminal: true,
  };
}

function makeDispatchStatus(problem: DispatchProblem): CodeTaskDispatchStatus {
  const now = Timestamp.fromDate(new Date('2026-06-08T10:00:00.000Z'));
  return {
    state: 'terminal',
    reason: problem.reason,
    terminal: true,
    severity: problem.severity,
    message: problem.message,
    remediation: problem.remediation,
    workerNames: problem.workerNames,
    firstSeenAt: now,
    lastSeenAt: now,
    nextAction: 'retry_after_fix',
  };
}

function makeNotificationRepo(): CodeTaskDispatchNotificationRepository & {
  reserved: string[];
  delivered: string[];
  failed: { id: string; error: string }[];
} {
  return {
    reserved: [],
    delivered: [],
    failed: [],
    reserve: vi.fn(async (input) => {
      const id = `${input.taskId}:${input.channel}:${input.reason}:${input.phase}`;
      return ok({ reserved: true, id });
    }),
    markDelivered: vi.fn(async function markDelivered(this: { delivered: string[] }, id: string) {
      this.delivered.push(id);
      return ok(undefined);
    }),
    markFailed: vi.fn(async function markFailed(this: { failed: { id: string; error: string }[] }, id: string, errorMessage: string) {
      this.failed.push({ id, error: errorMessage });
      return ok(undefined);
    }),
  };
}

describe('reportDispatchFailure', () => {
  it('writes task log, PR dispatch failure event, and WhatsApp notification through the ledger', async () => {
    const task = makeTask();
    const problem = makeProblem();
    const dispatchStatus = makeDispatchStatus(problem);
    const notificationRepo = makeNotificationRepo();
    const storeBatch = vi.fn(async () => ok(undefined));
    const record = vi.fn(async () => undefined);
    const recordWithResult = vi.fn(async () => ok(undefined));
    const notifyTaskDispatchBlocked = vi.fn(async () => ok(undefined));

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus,
      phase: 'terminal',
      affectedTaskCount: 2,
      logLineRepo: { storeBatch, listRecent: vi.fn(async () => ok([])) },
      automationLog: { record, recordWithResult },
      whatsappNotifier: { notifyTaskDispatchBlocked } as never,
      notificationRepo,
      logger: { warn: vi.fn() } as never,
      now: new Date('2026-06-08T10:00:00.000Z'),
    });

    expect(storeBatch).toHaveBeenCalledWith(task.id, [
      expect.objectContaining({
        text: expect.stringContaining('worker_health_contract_mismatch'),
      }),
    ]);
    expect(recordWithResult).toHaveBeenCalledWith(
      { repository: 'owner/repo', prNumber: 123 },
      expect.objectContaining({
        type: 'task_dispatch_failed',
        taskId: task.id,
        reason: problem.reason,
        terminal: true,
        logLines: [expect.stringContaining('worker_health_contract_mismatch')],
      }),
      task.userId
    );
    expect(record).not.toHaveBeenCalled();
    expect(notifyTaskDispatchBlocked).toHaveBeenCalledWith(task.userId, expect.objectContaining({
      reason: problem.reason,
      affectedTaskCount: 2,
      exampleTaskId: task.id,
    }));
    expect(notificationRepo.markDelivered).toHaveBeenCalledTimes(3);
  });

  it('writes waiting log text without optional workers or affected count', async () => {
    const task = makeTask();
    delete task.prNumber;
    const problem: DispatchProblem = {
      ...makeProblem(),
      reason: 'workers_unreachable',
      severity: 'warning',
      workerNames: [],
      terminal: false,
    };
    const dispatchStatus: CodeTaskDispatchStatus = {
      ...makeDispatchStatus(problem),
      state: 'waiting',
      terminal: false,
    };
    const storeBatch = vi.fn(async () => ok(undefined));

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus,
      phase: 'waiting',
      affectedTaskCount: 1,
      logLineRepo: { storeBatch, listRecent: vi.fn(async () => ok([])) },
      automationLog: { record: vi.fn(async () => undefined) },
      whatsappNotifier: { notifyTaskDispatchBlocked: vi.fn(async () => ok(undefined)) } as never,
      notificationRepo: makeNotificationRepo(),
      logger: { warn: vi.fn() } as never,
      now: new Date('2026-06-08T10:00:00.000Z'),
    });

    expect(storeBatch).toHaveBeenCalledWith(task.id, [
      expect.objectContaining({
        text: '[dispatch:waiting] workers_unreachable: Configured workers responded with an incompatible health contract. Remediation: Deploy or restart the worker orchestrator, then retry this task..',
      }),
    ]);
  });

  it('logs and skips a side effect when ledger reservation fails', async () => {
    const task = makeTask();
    delete task.prNumber;
    const problem = makeProblem();
    const warn = vi.fn();
    const storeBatch = vi.fn(async () => ok(undefined));

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus: makeDispatchStatus(problem),
      phase: 'terminal',
      affectedTaskCount: 1,
      logLineRepo: { storeBatch, listRecent: vi.fn(async () => ok([])) },
      automationLog: { record: vi.fn(async () => undefined) },
      whatsappNotifier: { notifyTaskDispatchBlocked: vi.fn(async () => ok(undefined)) } as never,
      notificationRepo: {
        reserve: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'ledger down' })),
        markDelivered: vi.fn(async () => ok(undefined)),
        markFailed: vi.fn(async () => ok(undefined)),
      },
      logger: { warn } as never,
    });

    expect(storeBatch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.id, channel: 'task_log' }),
      'Failed to reserve dispatch failure side effect'
    );
  });

  it('logs when a delivered ledger update fails after the side effect succeeds', async () => {
    const task = makeTask();
    delete task.prNumber;
    const problem = makeProblem();
    const warn = vi.fn();

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus: makeDispatchStatus(problem),
      phase: 'terminal',
      affectedTaskCount: 1,
      logLineRepo: { storeBatch: vi.fn(async () => ok(undefined)), listRecent: vi.fn(async () => ok([])) },
      automationLog: { record: vi.fn(async () => undefined) },
      whatsappNotifier: { notifyTaskDispatchBlocked: vi.fn(async () => ok(undefined)) } as never,
      notificationRepo: {
        reserve: vi.fn(async (input) => ok({
          reserved: input.channel === 'task_log',
          id: `${input.taskId}:${input.channel}:${input.reason}:${input.phase}`,
        })),
        markDelivered: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'write failed' })),
        markFailed: vi.fn(async () => ok(undefined)),
      },
      logger: { warn } as never,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.id, channel: 'task_log' }),
      'Failed to mark dispatch failure side effect delivered'
    );
  });

  it('marks task-log side effect failed when log storage fails', async () => {
    const task = makeTask();
    delete task.prNumber;
    const problem = makeProblem();
    const notificationRepo = makeNotificationRepo();

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus: makeDispatchStatus(problem),
      phase: 'terminal',
      affectedTaskCount: 1,
      logLineRepo: {
        storeBatch: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'log write failed' })),
        listRecent: vi.fn(async () => ok([])),
      },
      automationLog: { record: vi.fn(async () => undefined) },
      whatsappNotifier: { notifyTaskDispatchBlocked: vi.fn(async () => ok(undefined)) } as never,
      notificationRepo,
      logger: { warn: vi.fn() } as never,
    });

    expect(notificationRepo.markFailed).toHaveBeenCalledWith(
      'task_1:task_log:worker_health_contract_mismatch:terminal',
      'log write failed'
    );
  });

  it('logs when marking a failed side effect also fails', async () => {
    const task = makeTask();
    delete task.prNumber;
    const problem = makeProblem();
    const warn = vi.fn();

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus: makeDispatchStatus(problem),
      phase: 'terminal',
      affectedTaskCount: 1,
      logLineRepo: {
        storeBatch: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'log write failed' })),
        listRecent: vi.fn(async () => ok([])),
      },
      automationLog: { record: vi.fn(async () => undefined) },
      whatsappNotifier: { notifyTaskDispatchBlocked: vi.fn(async () => ok(undefined)) } as never,
      notificationRepo: {
        reserve: vi.fn(async (input) => ok({
          reserved: input.channel === 'task_log',
          id: `${input.taskId}:${input.channel}:${input.reason}:${input.phase}`,
        })),
        markDelivered: vi.fn(async () => ok(undefined)),
        markFailed: vi.fn(async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'failed marker write failed' })),
      },
      logger: { warn } as never,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.id, channel: 'task_log' }),
      'Failed to mark dispatch failure side effect failed'
    );
  });

  it('marks WhatsApp side effect failed when publishing fails', async () => {
    const task = makeTask();
    delete task.prNumber;
    const problem = makeProblem();
    const notificationRepo = makeNotificationRepo();

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus: makeDispatchStatus(problem),
      phase: 'terminal',
      affectedTaskCount: 1,
      logLineRepo: { storeBatch: vi.fn(async () => ok(undefined)), listRecent: vi.fn(async () => ok([])) },
      automationLog: { record: vi.fn(async () => undefined) },
      whatsappNotifier: {
        notifyTaskDispatchBlocked: vi.fn(async () => err({ code: 'PUBLISH_FAILED', message: 'pubsub down' })),
      } as never,
      notificationRepo,
      logger: { warn: vi.fn() } as never,
      now: new Date('2026-06-08T10:00:00.000Z'),
    });

    expect(notificationRepo.markFailed).toHaveBeenCalledWith(
      'task_1:whatsapp:worker_health_contract_mismatch:terminal',
      'pubsub down'
    );
  });

  it('marks PR comment side effect failed when automation log reports failure', async () => {
    const task = makeTask();
    const problem = makeProblem();
    const notificationRepo = makeNotificationRepo();

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus: makeDispatchStatus(problem),
      phase: 'terminal',
      affectedTaskCount: 1,
      logLineRepo: { storeBatch: vi.fn(async () => ok(undefined)), listRecent: vi.fn(async () => ok([])) },
      automationLog: {
        record: vi.fn(async () => undefined),
        recordWithResult: vi.fn(async () => err({
          code: 'AUTOMATION_LOG_FAILED' as const,
          message: 'failed to post PR comment',
        })),
      },
      whatsappNotifier: { notifyTaskDispatchBlocked: vi.fn(async () => ok(undefined)) } as never,
      notificationRepo,
      logger: { warn: vi.fn() } as never,
    });

    expect(notificationRepo.markFailed).toHaveBeenCalledWith(
      'task_1:pr_comment:worker_health_contract_mismatch:terminal',
      'failed to post PR comment'
    );
  });

  it('falls back to legacy automation log record when result API is unavailable', async () => {
    const task = makeTask();
    const problem = makeProblem();
    const record = vi.fn(async () => undefined);

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus: makeDispatchStatus(problem),
      phase: 'terminal',
      affectedTaskCount: 1,
      logLineRepo: { storeBatch: vi.fn(async () => ok(undefined)), listRecent: vi.fn(async () => ok([])) },
      automationLog: { record },
      whatsappNotifier: { notifyTaskDispatchBlocked: vi.fn(async () => ok(undefined)) } as never,
      notificationRepo: makeNotificationRepo(),
      logger: { warn: vi.fn() } as never,
    });

    expect(record).toHaveBeenCalledWith(
      { repository: 'owner/repo', prNumber: 123 },
      expect.objectContaining({ type: 'task_dispatch_failed' }),
      task.userId
    );
  });

  it('skips side effects when the ledger entry is already delivered or reserved', async () => {
    const task = makeTask();
    const problem = makeProblem();
    const storeBatch = vi.fn(async () => ok(undefined));
    const record = vi.fn(async () => undefined);
    const notifyTaskDispatchBlocked = vi.fn(async () => ok(undefined));

    await reportDispatchFailure({
      task,
      problem,
      dispatchStatus: makeDispatchStatus(problem),
      phase: 'terminal',
      affectedTaskCount: 1,
      logLineRepo: { storeBatch, listRecent: vi.fn(async () => ok([])) },
      automationLog: { record },
      whatsappNotifier: { notifyTaskDispatchBlocked } as never,
      notificationRepo: {
        reserve: vi.fn(async (input) => ok({
          reserved: input.channel === 'task_log',
          id: `${input.taskId}:${input.channel}:${input.reason}:${input.phase}`,
        })),
        markDelivered: vi.fn(async () => ok(undefined)),
        markFailed: vi.fn(async () => ok(undefined)),
      },
      logger: { warn: vi.fn() } as never,
    });

    expect(storeBatch).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
    expect(notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });
});
