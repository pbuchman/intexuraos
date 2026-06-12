import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskSystemStatusRepository } from '../repositories/codeTaskSystemStatusRepository.js';
import type { CodeTaskDispatchability } from './codeTaskDispatchBlockers.js';

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
  readonly logger: Logger;
}

export function createCodeTaskDispatchStatusService(
  deps: CodeTaskDispatchStatusServiceDeps
): CodeTaskDispatchStatusService {
  const {
    statusRepo,
    logger,
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

      return;
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
