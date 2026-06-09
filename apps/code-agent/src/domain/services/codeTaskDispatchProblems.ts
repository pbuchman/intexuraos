import { Timestamp } from '@google-cloud/firestore';
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
  terminalCause?: CodeTaskDispatchStatus['terminalCause'];
  workerHealthDetails?: CodeTaskDispatchStatus['workerHealthDetails'];
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
    ...(blocker.workerHealthDetails !== undefined && { workerHealthDetails: blocker.workerHealthDetails }),
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
  terminalCause?: CodeTaskDispatchStatus['terminalCause'];
  workerNames?: string[];
}): DispatchProblem {
  return {
    reason: 'queue_timeout',
    severity: 'critical',
    message: input.message,
    remediation: input.remediation,
    workerNames: input.workerNames ?? [],
    terminal: true,
    ...(input.terminalCause !== undefined && { terminalCause: input.terminalCause }),
  };
}

export function queueTimeoutDispatchProblemFromTask(task: CodeTask, ttlMinutes: number): DispatchProblem {
  const previous = task.dispatchStatus;
  if (previous !== undefined && previous.reason !== 'queue_timeout') {
    return queueTimeoutDispatchProblem({
      message: `Task expired in queue after ${String(ttlMinutes)} minutes while blocked by ${previous.reason}: ${previous.message}`,
      remediation: previous.remediation,
      workerNames: previous.workerNames,
      terminalCause: {
        reason: previous.reason,
        message: previous.message,
        remediation: previous.remediation,
        workerNames: previous.workerNames,
        lastSeenAt: previous.lastSeenAt,
      },
    });
  }

  return queueTimeoutDispatchProblem({
    message: `Task expired in queue after ${String(ttlMinutes)} minutes before a worker could start.`,
    remediation: 'Retry this task after worker capacity is available.',
  });
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

export function retryExpiredDispatchProblem(input: {
  ttlMinutes: number;
  attempts: number;
  lastError: string;
}): DispatchProblem {
  return {
    reason: 'retry_expired',
    severity: 'critical',
    message: `Dispatch retry expired after ${String(input.ttlMinutes)} minutes and ${String(input.attempts)} attempts: ${input.lastError}`,
    remediation: 'Fix the dispatch blocker, then retry this task.',
    workerNames: [],
    terminal: true,
    terminalCause: {
      reason: 'dispatch_failed',
      message: input.lastError,
      remediation: 'Fix the underlying dispatch error, then retry this task.',
      workerNames: [],
      lastSeenAt: Timestamp.now(),
    },
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
    terminalCause: {
      reason: 'dispatch_failed',
      message: lastError,
      remediation: 'Fix the underlying dispatch error, then retry this task.',
      workerNames: [],
      lastSeenAt: Timestamp.now(),
    },
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
    ...(input.problem.terminalCause !== undefined && { terminalCause: input.problem.terminalCause }),
    ...(input.problem.workerHealthDetails !== undefined && { workerHealthDetails: input.problem.workerHealthDetails }),
  };
}

export async function notifyDispatchProblemForTask(
  input: NotifyDispatchProblemForTaskInput
): Promise<void> {
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
