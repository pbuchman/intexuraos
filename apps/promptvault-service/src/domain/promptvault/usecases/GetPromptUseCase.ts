/**
 * Use case for getting a single prompt by ID.
 */
import { err, type Result } from '@intexuraos/common-core';
import type { Prompt, PromptId, PromptVaultError } from '../models/index.js';
import { createPromptVaultError } from '../models/index.js';
import type { PromptRepository } from '../ports/index.js';
import type { Logger } from '@intexuraos/common-core';

/**
 * Input for the GetPrompt use case.
 */
export interface GetPromptUseCaseInput {
  userId: string;
  promptId: PromptId;
}

/**
 * Dependencies for the GetPrompt use case.
 */
export interface GetPromptDeps {
  logger: Logger;
}

/**
 * Validate input for getting a prompt.
 */
function validateInput(input: GetPromptUseCaseInput): PromptVaultError | null {
  if (input.promptId.trim().length === 0) {
    return createPromptVaultError('VALIDATION_ERROR', 'promptId is required');
  }
  return null;
}

/**
 * Execute the GetPrompt use case.
 */
export async function getPrompt(
  repository: PromptRepository,
  input: GetPromptUseCaseInput,
  deps: GetPromptDeps
): Promise<Result<Prompt, PromptVaultError>> {
  const { logger } = deps;

  logger.debug({ userId: input.userId, promptId: input.promptId }, 'Getting prompt');

  const validationError = validateInput(input);
  if (validationError !== null) {
    logger.warn(
      { userId: input.userId, promptId: input.promptId },
      'Prompt validation failed: promptId is required'
    );
    return err(validationError);
  }

  const result = await repository.getPrompt(input.userId, input.promptId);

  if (!result.ok) {
    logger.error(
      { userId: input.userId, promptId: input.promptId, errorMessage: result.error.message },
      'Failed to get prompt'
    );
    return result;
  }

  logger.debug({ userId: input.userId, promptId: input.promptId }, 'Prompt retrieved successfully');
  return result;
}

/**
 * Factory to create a bound GetPrompt use case.
 */
export function createGetPromptUseCase(
  repository: PromptRepository,
  logger: Logger
): (input: GetPromptUseCaseInput) => Promise<Result<Prompt, PromptVaultError>> {
  return async (input) => await getPrompt(repository, input, { logger });
}
