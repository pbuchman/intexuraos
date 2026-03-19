/**
 * Idempotency check for processed actions.
 * Ensures duplicate action requests return existing results.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger, ServiceFeedback } from '@intexuraos/common-core';
import type { ProcessedActionRepository } from '../index.js';
import type { LinearError } from '../errors.js';

export interface CheckIdempotencyDeps {
  repository: ProcessedActionRepository;
  logger: Logger;
}

/**
 * Check if an action has already been processed.
 *
 * @returns ok(null) if action not yet processed (caller should continue)
 * @returns ok(ServiceFeedback) if already processed (caller should return early)
 * @returns err if repository check fails
 */
export async function checkProcessedAction(
  actionId: string,
  deps: CheckIdempotencyDeps
): Promise<Result<ServiceFeedback | null, LinearError>> {
  const { repository, logger } = deps;
  const existingResult = await repository.getByActionId(actionId);
  if (!existingResult.ok) {
    logger.error({ actionId, error: existingResult.error }, 'Failed to check processed action');
    return err(existingResult.error);
  }

  if (existingResult.value !== null) {
    const existing = existingResult.value;
    logger.info(
      { actionId, issueIdentifier: existing.issueIdentifier },
      'Action already processed, returning existing result'
    );
    return ok({
      status: 'completed',
      message: `Issue ${existing.issueIdentifier} created successfully`,
      resourceUrl: existing.resourceUrl,
    });
  }

  return ok(null);
}
