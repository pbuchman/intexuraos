import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskSystemStatusRepository } from '../repositories/codeTaskSystemStatusRepository.js';
import type { WhatsAppNotifier } from './whatsappNotifier.js';
import type { CodeTaskDispatchability } from './codeTaskDispatchBlockers.js';

const DEFAULT_RESEND_INTERVAL_MS = 6 * 60 * 60 * 1000;

type DispatchBlocker = Extract<CodeTaskDispatchability, { dispatchable: false }>;

export interface RecordCodeTaskDispatchBlockedInput {
  readonly userId: string;
  readonly workerType: string;
  readonly blocker: DispatchBlocker;
  readonly affectedTaskCount: number;
  readonly exampleTaskIds: readonly string[];
}

export interface ResolveCodeTaskDispatchBlockersInput {
  readonly userId: string;
  readonly workerType: string;
}

export interface CodeTaskDispatchStatusService {
  recordDispatchBlocked(input: RecordCodeTaskDispatchBlockedInput): Promise<void>;
  resolveDispatchBlockers(input: ResolveCodeTaskDispatchBlockersInput): Promise<void>;
}

export interface CodeTaskDispatchStatusServiceDeps {
  readonly statusRepo: CodeTaskSystemStatusRepository;
  readonly whatsappNotifier: WhatsAppNotifier;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly resendIntervalMs?: number;
}

function shouldNotify(lastNotifiedAt: Date | undefined, now: Date, resendIntervalMs: number): boolean {
  if (lastNotifiedAt === undefined) {
    return true;
  }
  return now.getTime() - lastNotifiedAt.getTime() >= resendIntervalMs;
}

export function createCodeTaskDispatchStatusService(
  deps: CodeTaskDispatchStatusServiceDeps
): CodeTaskDispatchStatusService {
  const {
    statusRepo,
    whatsappNotifier,
    logger,
    now = (): Date => new Date(),
    resendIntervalMs = DEFAULT_RESEND_INTERVAL_MS,
  } = deps;

  return {
    async recordDispatchBlocked(input: RecordCodeTaskDispatchBlockedInput): Promise<void> {
      const upsertResult = await statusRepo.upsertActive({
        userId: input.userId,
        workerType: input.workerType,
        reason: input.blocker.reason,
        severity: input.blocker.severity,
        message: input.blocker.message,
        remediation: input.blocker.remediation,
        affectedTaskCount: input.affectedTaskCount,
        exampleTaskIds: input.exampleTaskIds,
        workerNames: input.blocker.workerNames,
      });

      if (!upsertResult.ok) {
        logger.error({ error: upsertResult.error, input }, 'Failed to persist code task dispatch system status');
        return;
      }

      const status = upsertResult.value;
      const notificationTime = now();
      if (!shouldNotify(status.lastNotifiedAt, notificationTime, resendIntervalMs)) {
        return;
      }

      const exampleTaskId = input.exampleTaskIds[0];
      const notifyResult = await whatsappNotifier.notifyTaskDispatchBlocked(input.userId, {
        workerType: input.workerType,
        reason: input.blocker.reason,
        affectedTaskCount: input.affectedTaskCount,
        ...(exampleTaskId !== undefined && { exampleTaskId }),
        message: input.blocker.message,
        remediation: input.blocker.remediation,
        workerNames: input.blocker.workerNames,
      });

      if (!notifyResult.ok) {
        logger.warn({ error: notifyResult.error, statusId: status.id }, 'Failed to notify user about code task dispatch blocker');
        return;
      }

      const markResult = await statusRepo.markNotified(status.id, notificationTime);
      if (!markResult.ok) {
        logger.warn({ error: markResult.error, statusId: status.id }, 'Failed to mark code task dispatch blocker as notified');
      }
    },

    async resolveDispatchBlockers(input: ResolveCodeTaskDispatchBlockersInput): Promise<void> {
      const result = await statusRepo.resolveActive({
        userId: input.userId,
        workerType: input.workerType,
      });
      if (!result.ok) {
        logger.warn({ error: result.error, input }, 'Failed to resolve code task dispatch system statuses');
      }
    },
  };
}
