/**
 * Use case for listing all prompts in the PromptVault.
 */
import type { Result } from '@intexuraos/common-core';
import type { Prompt, PromptVaultError } from '../models/index.js';
import type { PromptRepository } from '../ports/index.js';
import type { Logger } from '@intexuraos/common-core';

/**
 * Input for the ListPrompts use case.
 */
export interface ListPromptsUseCaseInput {
  userId: string;
}

/**
 * Dependencies for the ListPrompts use case.
 */
export interface ListPromptsDeps {
  logger: Logger;
}

/**
 * Execute the ListPrompts use case.
 */
export async function listPrompts(
  repository: PromptRepository,
  input: ListPromptsUseCaseInput,
  deps: ListPromptsDeps
): Promise<Result<Prompt[], PromptVaultError>> {
  const { logger } = deps;

  logger.debug({ userId: input.userId }, 'Listing prompts');

  const result = await repository.listPrompts(input.userId);

  if (!result.ok) {
    logger.error(
      { userId: input.userId, errorMessage: result.error.message },
      'Failed to list prompts'
    );
    return result;
  }

  logger.debug({ userId: input.userId, count: result.value.length }, 'Prompts listed successfully');
  return result;
}

/**
 * Factory to create a bound ListPrompts use case.
 */
export function createListPromptsUseCase(
  repository: PromptRepository,
  logger: Logger
): (input: ListPromptsUseCaseInput) => Promise<Result<Prompt[], PromptVaultError>> {
  return async (input) => await listPrompts(repository, input, { logger });
}
