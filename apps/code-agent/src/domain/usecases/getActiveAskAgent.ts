/**
 * Use case: Get the user's active/latest ask-agent task.
 *
 * Returns the most recent non-archived ask-agent task for cross-device
 * conversation restoration. Returns null if no such task exists.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { CodeTask } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';

export interface GetActiveAskAgentRequest {
  userId: string;
}

export interface GetActiveAskAgentResult {
  task: CodeTask | null;
}

export interface GetActiveAskAgentError {
  code: 'internal_error';
  message: string;
}

export interface GetActiveAskAgentDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
}

export async function getActiveAskAgent(
  deps: GetActiveAskAgentDeps,
  request: GetActiveAskAgentRequest,
): Promise<Result<GetActiveAskAgentResult, GetActiveAskAgentError>> {
  const { logger, codeTaskRepo } = deps;
  const { userId } = request;

  const result = await codeTaskRepo.findLatestAskAgentTask(userId);

  if (!result.ok) {
    logger.error({ userId, error: result.error }, 'Failed to find active ask-agent task');
    return err({ code: 'internal_error', message: result.error.message });
  }

  return ok({ task: result.value });
}
