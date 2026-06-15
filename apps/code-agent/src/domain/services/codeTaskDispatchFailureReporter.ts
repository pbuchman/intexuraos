import { Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type { CodeTask, CodeTaskDispatchStatus, CodeTaskDispatchStatusReason } from '../models/codeTask.js';
import type { FormattedLogLine } from '../models/logLine.js';
import type {
  CodeTaskDispatchNotificationChannel,
  CodeTaskDispatchNotificationPhase,
} from '../models/codeTaskDispatchNotification.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { CodeTaskDispatchNotificationRepository } from '../repositories/codeTaskDispatchNotificationRepository.js';
import type { AutomationLog } from '../ports/automationLog.js';
import type { WhatsAppNotifier } from './whatsappNotifier.js';
import type { DispatchProblem } from './codeTaskDispatchProblems.js';

export interface ReportDispatchFailureInput {
  task: CodeTask;
  problem: DispatchProblem;
  dispatchStatus: CodeTaskDispatchStatus;
  phase: CodeTaskDispatchNotificationPhase;
  affectedTaskCount: number;
  logLineRepo: LogLineRepository;
  automationLog: AutomationLog;
  whatsappNotifier: WhatsAppNotifier;
  notificationRepo: CodeTaskDispatchNotificationRepository;
  logger: Logger;
  now?: Date;
}

const DISPATCH_PHASE_SEQUENCE_SLOT: Record<CodeTaskDispatchNotificationPhase, number> = {
  waiting: 0,
  terminal: 1,
  timeout: 2,
  retry_expired: 3,
  retry_exhausted: 4,
  enqueue_failed: 5,
};

const DISPATCH_REASON_SEQUENCE_SLOT: Record<CodeTaskDispatchStatusReason, number> = {
  no_enabled_workers: 0,
  workers_unreachable: 1,
  worker_health_contract_mismatch: 2,
  workers_at_capacity: 3,
  codex_auth_unavailable: 4,
  claude_auth_unavailable: 5,
  provider_auth_unavailable: 6,
  docker_unavailable: 7,
  disk_unavailable: 8,
  unknown_worker_type: 9,
  worker_unavailable: 10,
  worker_busy: 11,
  at_capacity: 12,
  network_error: 13,
  dispatch_failed: 14,
  invalid_response: 15,
  queue_full: 16,
  queue_timeout: 17,
  retry_expired: 18,
  retry_exhausted: 19,
  missing_pr_branch: 20,
  scheduled_wait: 21,
  active_task_blocked: 22,
};

const DISPATCH_REASON_SEQUENCE_WIDTH = 100;

function dispatchLogText(
  input: Pick<ReportDispatchFailureInput, 'problem' | 'dispatchStatus' | 'affectedTaskCount'>
): string {
  const stateLabel = input.dispatchStatus.terminal ? 'failed' : 'waiting';
  const workers = input.problem.workerNames.length > 0
    ? ` Workers: ${input.problem.workerNames.join(', ')}.`
    : '';
  const affected = input.affectedTaskCount > 1
    ? ` Affected queued tasks: ${String(input.affectedTaskCount)}.`
    : '';
  return `[dispatch:${stateLabel}] ${input.problem.reason}: ${input.problem.message} Remediation: ${input.problem.remediation}.${workers}${affected}`;
}

function dispatchLogLine(
  input: Pick<ReportDispatchFailureInput, 'problem' | 'dispatchStatus' | 'phase' | 'affectedTaskCount' | 'now'>
): FormattedLogLine {
  const now = input.now ?? new Date();
  const firstSeenAtMs = input.dispatchStatus.firstSeenAt.toDate().getTime();
  return {
    sequence: firstSeenAtMs * 1000 + dispatchSequenceSuffix(input.phase, input.problem.reason),
    timestamp: Timestamp.fromDate(now),
    text: dispatchLogText(input),
  };
}

function dispatchSequenceSuffix(
  phase: CodeTaskDispatchNotificationPhase,
  reason: CodeTaskDispatchStatusReason
): number {
  return DISPATCH_PHASE_SEQUENCE_SLOT[phase] * DISPATCH_REASON_SEQUENCE_WIDTH
    + DISPATCH_REASON_SEQUENCE_SLOT[reason];
}

async function withLedger(
  input: ReportDispatchFailureInput,
  channel: CodeTaskDispatchNotificationChannel,
  action: (ledgerId: string) => Promise<void>
): Promise<void> {
  const reserveResult = await input.notificationRepo.reserve({
    taskId: input.task.id,
    channel,
    reason: input.problem.reason,
    phase: input.phase,
  });
  if (!reserveResult.ok) {
    input.logger.warn(
      { taskId: input.task.id, channel, reason: input.problem.reason, error: reserveResult.error },
      'Failed to reserve dispatch failure side effect'
    );
    return;
  }
  if (!reserveResult.value.reserved) {
    return;
  }

  try {
    await action(reserveResult.value.id);
    const deliveredResult = await input.notificationRepo.markDelivered(reserveResult.value.id);
    if (!deliveredResult.ok) {
      input.logger.warn(
        { taskId: input.task.id, channel, reason: input.problem.reason, error: deliveredResult.error },
        'Failed to mark dispatch failure side effect delivered'
      );
    }
  } catch (error) {
    const message = getErrorMessage(error);
    const failedResult = await input.notificationRepo.markFailed(reserveResult.value.id, message);
    if (!failedResult.ok) {
      input.logger.warn(
        { taskId: input.task.id, channel, reason: input.problem.reason, error: failedResult.error },
        'Failed to mark dispatch failure side effect failed'
      );
    }
    input.logger.warn(
      { taskId: input.task.id, channel, reason: input.problem.reason, error: message },
      'Dispatch failure side effect failed'
    );
  }
}

export async function reportDispatchFailure(input: ReportDispatchFailureInput): Promise<void> {
  const automationLogLines = [dispatchLogText(input)];

  await withLedger(input, 'task_log', async () => {
    const logLine = dispatchLogLine(input);
    const result = await input.logLineRepo.storeBatch(input.task.id, [logLine]);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  });

  if (input.task.prNumber !== undefined) {
    const prNumber = input.task.prNumber;
    await withLedger(input, 'pr_comment', async () => {
      const event = {
        type: 'task_dispatch_failed' as const,
        taskId: input.task.id,
        workerType: input.task.workerType,
        ...(input.task.agentType !== undefined && { agentType: input.task.agentType }),
        reason: input.problem.reason,
        message: input.problem.message,
        remediation: input.problem.remediation,
        workerNames: input.problem.workerNames,
        terminal: input.problem.terminal,
        errorCode: `dispatch_blocked_${input.problem.reason}`,
        idempotencyKey: `${input.task.id}:${input.phase}:${input.problem.reason}`,
        logLines: automationLogLines,
      };
      const prRef = { repository: input.task.repository, prNumber };
      if (input.automationLog.recordWithResult !== undefined) {
        const result = await input.automationLog.recordWithResult(prRef, event, input.task.userId);
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        return;
      }
      await input.automationLog.record(prRef, event, input.task.userId);
    });
  }

  await withLedger(input, 'whatsapp', async () => {
    const result = await input.whatsappNotifier.notifyTaskDispatchBlocked(input.task.userId, {
      workerType: input.task.workerType,
      reason: input.problem.reason,
      affectedTaskCount: input.affectedTaskCount,
      exampleTaskId: input.task.id,
      message: input.problem.message,
      remediation: input.problem.remediation,
      workerNames: input.problem.workerNames,
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  });
}
