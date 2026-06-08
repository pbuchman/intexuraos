import { Timestamp } from '@google-cloud/firestore';
import { ok } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  CodeTask,
  CodeTaskDispatchStatus,
  CodeTaskDispatchStatusReason,
  TaskError,
} from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { CodeTaskDispatchability } from './codeTaskDispatchBlockers.js';
import type { DispatchError } from './taskDispatcher.js';
import type { WhatsAppNotifier } from './whatsappNotifier.js';

export type DispatchBlocker = Extract<CodeTaskDispatchability, { dispatchable: false }>;

export interface DispatchProblem {
  reason: CodeTaskDispatchStatusReason;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  remediation: string;
  workerNames: string[];
  terminal: boolean;
}

export interface BuildDispatchStatusInput {
  task: CodeTask;
  problem: DispatchProblem;
  now?: Date;
}

export interface NotifyDispatchProblemForTaskInput {
  task: CodeTask;
  dispatchStatus: CodeTaskDispatchStatus;
  problem: DispatchProblem;
  whatsappNotifier: WhatsAppNotifier;
  codeTaskRepo: CodeTaskRepository;
  logger: Logger;
  affectedTaskCount: number;
  now?: Date;
}

const RECOVERABLE_BLOCKER_REASONS = new Set<CodeTaskDispatchStatusReason>([
  'workers_at_capacity',
  'workers_unreachable',
]);

const RECOVERABLE_ERROR_REASONS = new Set<CodeTaskDispatchStatusReason>([
  'worker_unavailable',
  'worker_busy',
  'at_capacity',
  'network_error',
]);

export function isTerminalDispatchBlockerReason(reason: CodeTaskDispatchStatusReason): boolean {
  return !RECOVERABLE_BLOCKER_REASONS.has(reason);
}

export function dispatchProblemFromBlocker(blocker: DispatchBlocker): DispatchProblem {
  return {
    reason: blocker.reason,
    severity: blocker.severity,
    message: blocker.message,
    remediation: blocker.remediation,
    workerNames: blocker.workerNames,
    terminal: isTerminalDispatchBlockerReason(blocker.reason),
  };
}

export function dispatchProblemFromError(error: DispatchError): DispatchProblem {
  if (error.blocker !== undefined) {
    return dispatchProblemFromBlocker(error.blocker);
  }

  const reason = error.code;
  const terminal = !RECOVERABLE_ERROR_REASONS.has(reason);
  return {
    reason,
    severity: terminal ? 'critical' : 'warning',
    message: terminal
      ? `Dispatch failed before the worker could start: ${error.message}`
      : `Dispatch is temporarily blocked: ${error.message}`,
    remediation: terminal
      ? 'Fix the worker dispatch/configuration issue, then retry this task.'
      : 'The scheduler will retry this task automatically while workers recover.',
    workerNames: [],
    terminal,
  };
}

export function queueFullDispatchProblem(message: string): DispatchProblem {
  return {
    reason: 'queue_full',
    severity: 'critical',
    message,
    remediation: 'Wait for queued work to drain, then retry this task.',
    workerNames: [],
    terminal: true,
  };
}

export function queueTimeoutDispatchProblem(input: {
  message: string;
  remediation: string;
}): DispatchProblem {
  return {
    reason: 'queue_timeout',
    severity: 'critical',
    message: input.message,
    remediation: input.remediation,
    workerNames: [],
    terminal: true,
  };
}

export function dispatchFailureProblem(input: {
  message: string;
  remediation: string;
}): DispatchProblem {
  return {
    reason: 'dispatch_failed',
    severity: 'critical',
    message: input.message,
    remediation: input.remediation,
    workerNames: [],
    terminal: true,
  };
}

export function missingPrBranchDispatchProblem(input: {
  agentType: 'review' | 'remediation';
  prNumber: number;
}): DispatchProblem {
  return {
    reason: 'missing_pr_branch',
    severity: 'critical',
    message: `prBranch required for ${input.agentType} task (PR #${String(input.prNumber)})`,
    remediation: 'Retry after the PR branch is available on the task payload.',
    workerNames: [],
    terminal: true,
  };
}

export function retryExpiredDispatchProblem(ttlMinutes: number): DispatchProblem {
  return {
    reason: 'retry_expired',
    severity: 'critical',
    message: `Dispatch retry expired after ${String(ttlMinutes)} minutes`,
    remediation: 'Fix the dispatch blocker, then retry this task.',
    workerNames: [],
    terminal: true,
  };
}

export function retryExhaustedDispatchProblem(attempts: number, lastError: string): DispatchProblem {
  return {
    reason: 'retry_exhausted',
    severity: 'critical',
    message: `Dispatch retry exhausted after ${String(attempts)} attempts: ${lastError}`,
    remediation: 'Fix the dispatch blocker, then retry this task.',
    workerNames: [],
    terminal: true,
  };
}

export function nextActionForDispatchProblem(
  problem: DispatchProblem
): CodeTaskDispatchStatus['nextAction'] {
  return problem.terminal ? 'retry_after_fix' : 'will_retry_automatically';
}

export function taskErrorFromDispatchStatus(dispatchStatus: CodeTaskDispatchStatus): TaskError {
  return {
    code: `dispatch_blocked_${dispatchStatus.reason}`,
    message: dispatchStatus.message,
    remediation: {
      action: dispatchStatus.terminal ? 'retry' : 'wait',
      manualSteps: dispatchStatus.remediation,
    },
  };
}

function existingNotifiedReasons(
  task: CodeTask
): Partial<Record<CodeTaskDispatchStatusReason, Timestamp>> {
  return task.dispatchStatus?.notifiedReasons ?? {};
}

function firstSeenAtForReason(
  task: CodeTask,
  reason: CodeTaskDispatchStatusReason,
  now: Timestamp
): Timestamp {
  return task.dispatchStatus?.reason === reason ? task.dispatchStatus.firstSeenAt : now;
}

export function buildDispatchStatusForProblem(
  input: BuildDispatchStatusInput
): CodeTaskDispatchStatus {
  const now = Timestamp.fromDate(input.now ?? new Date());
  const notifiedReasons = existingNotifiedReasons(input.task);

  return {
    state: input.problem.terminal ? 'terminal' : 'waiting',
    reason: input.problem.reason,
    terminal: input.problem.terminal,
    severity: input.problem.severity,
    message: input.problem.message,
    remediation: input.problem.remediation,
    workerNames: input.problem.workerNames,
    firstSeenAt: firstSeenAtForReason(input.task, input.problem.reason, now),
    lastSeenAt: now,
    nextAction: nextActionForDispatchProblem(input.problem),
    ...(Object.keys(notifiedReasons).length > 0 && { notifiedReasons }),
  };
}

export async function notifyDispatchProblemForTask(
  input: NotifyDispatchProblemForTaskInput
): Promise<void> {
  const notifiedReasons = input.dispatchStatus.notifiedReasons ?? {};
  if (notifiedReasons[input.problem.reason] !== undefined) {
    return;
  }

  const nextNotifiedReasons = {
    ...notifiedReasons,
    [input.problem.reason]: Timestamp.fromDate(input.now ?? new Date()),
  };

  const nextDispatchStatus: CodeTaskDispatchStatus = {
    ...input.dispatchStatus,
    notifiedReasons: nextNotifiedReasons,
  };

  const reserveResult = input.codeTaskRepo.runInTransaction !== undefined
    ? await input.codeTaskRepo.runInTransaction(async (transaction) => {
        const currentResult = await input.codeTaskRepo.findById(input.task.id, { transaction });
        if (!currentResult.ok) {
          return currentResult;
        }
        const currentStatus = currentResult.value.dispatchStatus;
        if (currentStatus?.reason !== input.problem.reason) {
          return ok({ shouldNotify: false });
        }
        if (currentStatus.notifiedReasons?.[input.problem.reason] !== undefined) {
          return ok({ shouldNotify: false });
        }
        const updateResult = await input.codeTaskRepo.update(input.task.id, {
          dispatchStatus: {
            ...currentStatus,
            notifiedReasons: {
              ...(currentStatus.notifiedReasons ?? {}),
              [input.problem.reason]: nextNotifiedReasons[input.problem.reason],
            },
          },
        }, { transaction });
        if (!updateResult.ok) {
          return updateResult;
        }
        return ok({ shouldNotify: true });
      })
    : await input.codeTaskRepo.update(input.task.id, {
        dispatchStatus: nextDispatchStatus,
      }).then((updateResult) => updateResult.ok ? ok({ shouldNotify: true }) : updateResult);

  if (!reserveResult.ok) {
    input.logger.warn(
      { taskId: input.task.id, reason: input.problem.reason, error: reserveResult.error },
      'Failed to persist code task dispatch notification ledger'
    );
    return;
  }

  if (!reserveResult.value.shouldNotify) {
    return;
  }

  const notifyResult = await input.whatsappNotifier.notifyTaskDispatchBlocked(input.task.userId, {
    workerType: input.task.workerType,
    reason: input.problem.reason,
    affectedTaskCount: input.affectedTaskCount,
    exampleTaskId: input.task.id,
    message: input.problem.message,
    remediation: input.problem.remediation,
    workerNames: input.problem.workerNames,
  });

  if (!notifyResult.ok) {
    input.logger.warn(
      { taskId: input.task.id, reason: input.problem.reason, error: notifyResult.error },
      'Failed to notify user about code task dispatch blocker'
    );
  }
}
