import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import {
  buildDispatchStatusForProblem,
  dispatchProblemFromError,
  missingPrBranchDispatchProblem,
  notifyDispatchProblemForTask,
  queueTimeoutDispatchProblemFromTask,
  taskErrorFromDispatchStatus,
  type DispatchProblem,
} from '../../../domain/services/codeTaskDispatchProblems.js';

function createTask(overrides: Partial<CodeTask> = {}): CodeTask {
  const now = Timestamp.fromDate(new Date('2026-06-06T10:00:00.000Z'));
  return {
    id: 'task-123',
    userId: 'user-456',
    traceId: 'trace-789',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'Fix the bug',
    systemPromptHash: 'hash',
    workerType: 'auto',
    workerLocation: 'pending',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    status: 'queued',
    callbackReceived: false,
    dedupKey: 'dedup-123',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('codeTaskDispatchProblems', () => {
  it('builds missing PR branch task errors as terminal retryable failures', () => {
    const problem = missingPrBranchDispatchProblem({ agentType: 'review', prNumber: 42 });
    const status = buildDispatchStatusForProblem({
      task: createTask(),
      problem,
      now: new Date('2026-06-06T11:00:00.000Z'),
    });

    expect(status).toEqual(expect.objectContaining({
      state: 'terminal',
      reason: 'missing_pr_branch',
      terminal: true,
      nextAction: 'retry_after_fix',
      message: 'prBranch required for review task (PR #42)',
    }));
    expect(taskErrorFromDispatchStatus(status)).toEqual({
      code: 'dispatch_blocked_missing_pr_branch',
      message: 'prBranch required for review task (PR #42)',
      remediation: {
        action: 'retry',
        manualSteps: 'Retry after the PR branch is available on the task payload.',
      },
    });
  });

  it('preserves firstSeenAt for repeated recoverable problems', () => {
    const firstSeenAt = Timestamp.fromDate(new Date('2026-06-06T09:00:00.000Z'));
    const notifiedAt = Timestamp.fromDate(new Date('2026-06-06T09:30:00.000Z'));
    const problem: DispatchProblem = {
      reason: 'worker_unavailable',
      severity: 'warning',
      message: 'Dispatch is temporarily blocked: no reachable worker',
      remediation: 'The scheduler will retry this task automatically while workers recover.',
      workerNames: [],
      terminal: false,
    };
    const task = createTask({
      dispatchStatus: {
        state: 'waiting',
        reason: 'worker_unavailable',
        terminal: false,
        severity: 'warning',
        message: 'Previous worker outage',
        remediation: 'Wait for recovery.',
        workerNames: [],
        firstSeenAt,
        lastSeenAt: firstSeenAt,
        nextAction: 'will_retry_automatically',
        notifiedReasons: {
          worker_unavailable: notifiedAt,
        },
      },
    });

    const status = buildDispatchStatusForProblem({
      task,
      problem,
      now: new Date('2026-06-06T10:00:00.000Z'),
    });

    expect(status.firstSeenAt).toBe(firstSeenAt);
    expect(status.notifiedReasons).toEqual({ worker_unavailable: notifiedAt });
    expect(taskErrorFromDispatchStatus(status).remediation).toEqual(expect.objectContaining({
      action: 'wait',
    }));
  });

  it('uses recoverable messaging for retryable dispatch errors', () => {
    expect(dispatchProblemFromError({ code: 'network_error', message: 'ECONNRESET' })).toEqual(
      expect.objectContaining({
        reason: 'network_error',
        terminal: false,
        severity: 'warning',
        message: 'Dispatch is temporarily blocked: ECONNRESET',
      }),
    );
  });

  it('copies blocker worker health diagnostics into dispatch status', () => {
    const problem = dispatchProblemFromError({
      code: 'worker_unavailable',
      message: 'Configured workers for codex-xhigh responded with an incompatible health contract.',
      blocker: {
        dispatchable: false,
        reason: 'worker_health_contract_mismatch',
        severity: 'critical',
        message: 'Configured workers for codex-xhigh responded with an incompatible health contract.',
        remediation: 'Deploy or restart the worker orchestrator so /health includes the required capability fields, then retry this task.',
        workerNames: ['legacy-a'],
        workerHealthDetails: [
          {
            workerName: 'legacy-a',
            tag: 'unknown',
            healthy: false,
            error: 'Health response missing worker capability details',
            contractMismatch: true,
            missingFields: ['providerApiKeys'],
          },
        ],
      },
    });
    const status = buildDispatchStatusForProblem({
      task: createTask(),
      problem,
      now: new Date('2026-06-06T11:00:00.000Z'),
    });

    expect(status.workerHealthDetails).toEqual([
      {
        workerName: 'legacy-a',
        tag: 'unknown',
        healthy: false,
        error: 'Health response missing worker capability details',
        contractMismatch: true,
        missingFields: ['providerApiKeys'],
      },
    ]);
  });

  it('preserves the previous blocker as queue timeout terminal cause', () => {
    const lastSeenAt = Timestamp.fromDate(new Date('2026-06-06T10:10:00.000Z'));
    const task = createTask({
      dispatchStatus: {
        state: 'waiting',
        reason: 'workers_unreachable',
        terminal: false,
        severity: 'warning',
        message: 'No configured workers are reachable for codex.',
        remediation: 'Check worker host connectivity.',
        workerNames: ['home-dev'],
        firstSeenAt: Timestamp.fromDate(new Date('2026-06-06T10:00:00.000Z')),
        lastSeenAt,
        nextAction: 'will_retry_automatically',
      },
    });

    const problem = queueTimeoutDispatchProblemFromTask(task, 1440);
    const status = buildDispatchStatusForProblem({ task, problem });

    expect(problem.message).toContain('expired in queue after 1440 minutes while blocked by workers_unreachable');
    expect(status).toEqual(expect.objectContaining({
      reason: 'queue_timeout',
      workerNames: ['home-dev'],
      terminalCause: {
        reason: 'workers_unreachable',
        message: 'No configured workers are reachable for codex.',
        remediation: 'Check worker host connectivity.',
        workerNames: ['home-dev'],
        lastSeenAt,
      },
    }));
  });

  it('uses a generic queue timeout message when no previous blocker exists', () => {
    const problem = queueTimeoutDispatchProblemFromTask(createTask(), 1440);

    expect(problem).toEqual(expect.objectContaining({
      reason: 'queue_timeout',
      message: 'Task expired in queue after 1440 minutes before a worker could start.',
      workerNames: [],
    }));
  });

  it('sends WhatsApp notification with dispatch problem context', async () => {
    const problem: DispatchProblem = {
      reason: 'queue_full',
      severity: 'critical',
      message: 'Queue is full.',
      remediation: 'Try again later.',
      workerNames: [],
      terminal: true,
    };
    const task = createTask();
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const whatsappNotifier = { notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)) };
    const codeTaskRepo = { update: vi.fn().mockResolvedValue(ok(createTask())) };

    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier: whatsappNotifier as never,
      codeTaskRepo: codeTaskRepo as never,
      logger: createLogger(),
      affectedTaskCount: 1,
    });

    expect(whatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith('user-456', {
      workerType: 'auto',
      reason: 'queue_full',
      affectedTaskCount: 1,
      exampleTaskId: 'task-123',
      message: 'Queue is full.',
      remediation: 'Try again later.',
      workerNames: [],
    });
    expect(codeTaskRepo.update).toHaveBeenCalledWith('task-123', {
      dispatchStatus: expect.objectContaining({
        notifiedReasons: expect.objectContaining({
          queue_full: expect.any(Timestamp),
        }),
      }),
    });
  });

  it('does not resend WhatsApp notifications for a reason already in the task ledger', async () => {
    const problem: DispatchProblem = {
      reason: 'queue_full',
      severity: 'critical',
      message: 'Queue is full.',
      remediation: 'Try again later.',
      workerNames: [],
      terminal: true,
    };
    const task = createTask({
      dispatchStatus: {
        state: 'terminal',
        reason: 'queue_full',
        terminal: true,
        severity: 'critical',
        message: 'Queue is full.',
        remediation: 'Try again later.',
        workerNames: [],
        firstSeenAt: Timestamp.fromDate(new Date('2026-06-06T09:00:00.000Z')),
        lastSeenAt: Timestamp.fromDate(new Date('2026-06-06T09:00:00.000Z')),
        nextAction: 'retry_after_fix',
        notifiedReasons: {
          queue_full: Timestamp.fromDate(new Date('2026-06-06T09:01:00.000Z')),
        },
      },
    });
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const whatsappNotifier = { notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)) };
    const codeTaskRepo = { update: vi.fn().mockResolvedValue(ok(createTask())) };

    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier: whatsappNotifier as never,
      codeTaskRepo: codeTaskRepo as never,
      logger: createLogger(),
      affectedTaskCount: 1,
    });

    expect(whatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('does not notify when transactional ledger persistence sees a changed status', async () => {
    const problem: DispatchProblem = {
      reason: 'workers_at_capacity',
      severity: 'warning',
      message: 'All workers are busy.',
      remediation: 'Wait for a worker.',
      workerNames: ['home-mac'],
      terminal: false,
    };
    const task = createTask();
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const transaction = {};
    const whatsappNotifier = { notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)) };
    const codeTaskRepo = {
      runInTransaction: vi.fn(async (operation: (tx: never) => unknown) => await operation(transaction as never)),
      findById: vi.fn().mockResolvedValue(ok(createTask())),
      update: vi.fn(),
    };

    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier: whatsappNotifier as never,
      codeTaskRepo: codeTaskRepo as never,
      logger: createLogger(),
      affectedTaskCount: 1,
    });

    expect(codeTaskRepo.findById).toHaveBeenCalledWith('task-123', { transaction });
    expect(codeTaskRepo.update).not.toHaveBeenCalled();
    expect(whatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('skips transactional ledger write when current dispatch status already recorded the notification', async () => {
    const notifiedAt = Timestamp.fromDate(new Date('2026-06-06T10:20:00.000Z'));
    const problem: DispatchProblem = {
      reason: 'workers_at_capacity',
      severity: 'warning',
      message: 'All workers are busy.',
      remediation: 'Wait for a worker.',
      workerNames: ['home-mac'],
      terminal: false,
    };
    const task = createTask();
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const currentTask = createTask({
      dispatchStatus: {
        ...dispatchStatus,
        notifiedReasons: {
          workers_at_capacity: notifiedAt,
        },
      },
    });
    const transaction = {};
    const whatsappNotifier = { notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)) };
    const codeTaskRepo = {
      runInTransaction: vi.fn(async (operation: (tx: never) => unknown) => await operation(transaction as never)),
      findById: vi.fn().mockResolvedValue(ok(currentTask)),
      update: vi.fn(),
    };

    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier: whatsappNotifier as never,
      codeTaskRepo: codeTaskRepo as never,
      logger: createLogger(),
      affectedTaskCount: 1,
    });

    expect(codeTaskRepo.update).not.toHaveBeenCalled();
    expect(whatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('reserves transactional ledger before sending WhatsApp notification', async () => {
    const problem: DispatchProblem = {
      reason: 'workers_at_capacity',
      severity: 'warning',
      message: 'All workers are busy.',
      remediation: 'Wait for a worker.',
      workerNames: ['home-mac'],
      terminal: false,
    };
    const task = createTask();
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const currentTask = createTask({
      dispatchStatus,
    });
    const transaction = {};
    const whatsappNotifier = { notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)) };
    const codeTaskRepo = {
      runInTransaction: vi.fn(async (operation: (tx: never) => unknown) => await operation(transaction as never)),
      findById: vi.fn().mockResolvedValue(ok(currentTask)),
      update: vi.fn().mockResolvedValue(ok(currentTask)),
    };

    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier: whatsappNotifier as never,
      codeTaskRepo: codeTaskRepo as never,
      logger: createLogger(),
      affectedTaskCount: 1,
      now: new Date('2026-06-06T10:30:00.000Z'),
    });

    expect(codeTaskRepo.update).toHaveBeenCalledWith('task-123', {
      dispatchStatus: expect.objectContaining({
        notifiedReasons: expect.objectContaining({
          workers_at_capacity: Timestamp.fromDate(new Date('2026-06-06T10:30:00.000Z')),
        }),
      }),
    }, { transaction });
    expect(whatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledTimes(1);
  });

  it('logs and does not send when transactional ledger update fails', async () => {
    const problem: DispatchProblem = {
      reason: 'workers_at_capacity',
      severity: 'warning',
      message: 'All workers are busy.',
      remediation: 'Wait for a worker.',
      workerNames: ['home-mac'],
      terminal: false,
    };
    const task = createTask();
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const currentTask = createTask({
      dispatchStatus,
    });
    const logger = createLogger();
    const transaction = {};
    const whatsappNotifier = { notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)) };
    const codeTaskRepo = {
      runInTransaction: vi.fn(async (operation: (tx: never) => unknown) => await operation(transaction as never)),
      findById: vi.fn().mockResolvedValue(ok(currentTask)),
      update: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' })),
    };

    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier: whatsappNotifier as never,
      codeTaskRepo: codeTaskRepo as never,
      logger,
      affectedTaskCount: 1,
    });

    expect(whatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123', reason: 'workers_at_capacity' }),
      'Failed to persist code task dispatch notification ledger',
    );
  });

  it('logs when transactional ledger persistence cannot read the current task', async () => {
    const problem: DispatchProblem = {
      reason: 'workers_at_capacity',
      severity: 'warning',
      message: 'All workers are busy.',
      remediation: 'Wait for a worker.',
      workerNames: ['home-mac'],
      terminal: false,
    };
    const task = createTask();
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const logger = createLogger();
    const transaction = {};
    const whatsappNotifier = { notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)) };
    const codeTaskRepo = {
      runInTransaction: vi.fn(async (operation: (tx: never) => unknown) => await operation(transaction as never)),
      findById: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'read failed' })),
      update: vi.fn(),
    };

    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier: whatsappNotifier as never,
      codeTaskRepo: codeTaskRepo as never,
      logger,
      affectedTaskCount: 1,
    });

    expect(codeTaskRepo.update).not.toHaveBeenCalled();
    expect(whatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123', reason: 'workers_at_capacity' }),
      'Failed to persist code task dispatch notification ledger',
    );
  });

  it('logs when WhatsApp notification fails', async () => {
    const problem: DispatchProblem = {
      reason: 'workers_at_capacity',
      severity: 'warning',
      message: 'All workers are busy.',
      remediation: 'Wait for a worker.',
      workerNames: ['home-mac'],
      terminal: false,
    };
    const task = createTask();
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const logger = createLogger();
    const whatsappNotifier = {
      notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(err({ code: 'publish_failed', message: 'pubsub down' })),
    };
    const codeTaskRepo = { update: vi.fn().mockResolvedValue(ok(createTask())) };

    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier: whatsappNotifier as never,
      codeTaskRepo: codeTaskRepo as never,
      logger,
      affectedTaskCount: 1,
    });

    expect(codeTaskRepo.update).toHaveBeenCalledWith('task-123', {
      dispatchStatus: expect.objectContaining({
        notifiedReasons: expect.objectContaining({
          workers_at_capacity: expect.any(Timestamp),
        }),
      }),
    });
    expect(whatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123', reason: 'workers_at_capacity' }),
      'Failed to notify user about code task dispatch blocker',
    );
  });

  it('logs and does not send when notification ledger persistence fails', async () => {
    const problem: DispatchProblem = {
      reason: 'dispatch_failed',
      severity: 'critical',
      message: 'Dispatch failed.',
      remediation: 'Fix dispatch.',
      workerNames: [],
      terminal: true,
    };
    const task = createTask();
    const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
    const logger = createLogger();
    const whatsappNotifier = { notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)) };
    const codeTaskRepo = {
      update: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' })),
    };

    await notifyDispatchProblemForTask({
      task,
      dispatchStatus,
      problem,
      whatsappNotifier: whatsappNotifier as never,
      codeTaskRepo: codeTaskRepo as never,
      logger,
      affectedTaskCount: 1,
      now: new Date('2026-06-06T10:15:00.000Z'),
    });

    expect(codeTaskRepo.update).toHaveBeenCalledWith('task-123', {
      dispatchStatus: expect.objectContaining({
        notifiedReasons: expect.objectContaining({
          dispatch_failed: Timestamp.fromDate(new Date('2026-06-06T10:15:00.000Z')),
        }),
      }),
    });
    expect(whatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-123', reason: 'dispatch_failed' }),
      'Failed to persist code task dispatch notification ledger',
    );
  });
});
