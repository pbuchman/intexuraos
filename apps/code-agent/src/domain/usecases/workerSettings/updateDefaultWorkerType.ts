/**
 * Use case: update or clear a user's default worker type for a given agent
 * category (review, remediation, execution, planning, pull request).
 *
 * The literal string `"auto"` is a sentinel meaning "clear any stored
 * override and fall back to automatic selection". Any other value is a
 * concrete `CodeTaskWorkerType` and is written to the settings document.
 *
 * Input validation (restricting `workerType` to `CODE_TASK_WORKER_TYPES`)
 * is the caller's responsibility — typically the Fastify route schema.
 */

import type { CodeTaskWorkerType, Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  DefaultWorkerTypeField,
  WorkerSettingsRepository,
} from '../../ports/workerSettingsRepository.js';
import type { UseCaseLogger } from '../../ports/useCaseLogger.js';

export interface UpdateDefaultWorkerTypeDeps {
  workerSettingsRepo: WorkerSettingsRepository;
  logger: UseCaseLogger;
}

export interface UpdateDefaultWorkerTypeInput {
  userId: string;
  field: DefaultWorkerTypeField;
  /** Human-readable label used in logs (e.g. "review", "remediation"). */
  label: string;
  /**
   * Concrete worker type to store, or the sentinel `"auto"` to clear the
   * field and restore automatic selection. Must already be validated by
   * the caller (Fastify schema) to be a member of `CODE_TASK_WORKER_TYPES`.
   */
  workerType: CodeTaskWorkerType;
}

export interface UpdateDefaultWorkerTypeError {
  code: 'internal_error';
  message: string;
}

export type UpdateDefaultWorkerTypeUseCase = (
  input: UpdateDefaultWorkerTypeInput
) => Promise<Result<{ updated: true }, UpdateDefaultWorkerTypeError>>;

export function createUpdateDefaultWorkerTypeUseCase(
  deps: UpdateDefaultWorkerTypeDeps
): UpdateDefaultWorkerTypeUseCase {
  const { workerSettingsRepo, logger } = deps;

  return async ({ userId, field, label, workerType }) => {
    if (workerType === 'auto') {
      logger.info({ userId, field }, `Clearing default ${label} worker type (restoring auto)`);
      const result = await workerSettingsRepo.clearDefaultWorkerType(userId, field);
      if (!result.ok) {
        logger.error({ error: result.error, field }, `Failed to clear default ${label} worker type`);
        return err({ code: 'internal_error', message: result.error.message });
      }
      logger.info({ userId, field }, `Default ${label} worker type cleared`);
      return ok({ updated: true });
    }

    logger.info({ userId, workerType, field }, `Updating default ${label} worker type`);

    const result = await workerSettingsRepo.updateDefaultWorkerType(userId, field, workerType);

    if (!result.ok) {
      logger.error({ error: result.error, field }, `Failed to update default ${label} worker type`);
      return err({ code: 'internal_error', message: result.error.message });
    }

    logger.info({ userId, workerType, field }, `Default ${label} worker type updated`);
    return ok({ updated: true });
  };
}
