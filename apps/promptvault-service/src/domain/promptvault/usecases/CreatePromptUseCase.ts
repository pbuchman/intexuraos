/**
 * Use case for creating a new prompt in the PromptVault.
 */
import { err, type Result } from '@intexuraos/common-core';
import type { Prompt, PromptVaultError } from '../models/index.js';
import { createPromptVaultError } from '../models/index.js';
import type { PromptRepository } from '../ports/index.js';
import type { Logger } from '@intexuraos/common-core';

/**
 * Input for the CreatePrompt use case.
 */
export interface CreatePromptUseCaseInput {
  userId: string;
  title: string;
  content: string;
}

/**
 * Dependencies for the CreatePrompt use case.
 */
export interface CreatePromptDeps {
  logger: Logger;
}

/**
 * Validation constraints for prompt creation.
 */
const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 100000;

/**
 * Validate input for creating a prompt.
 */
function validateInput(input: CreatePromptUseCaseInput): PromptVaultError | null {
  if (input.title.trim().length === 0) {
    return createPromptVaultError('VALIDATION_ERROR', 'title is required');
  }
  if (input.title.length > TITLE_MAX_LENGTH) {
    return createPromptVaultError(
      'VALIDATION_ERROR',
      `title must be at most ${String(TITLE_MAX_LENGTH)} characters`
    );
  }
  if (input.content.trim().length === 0) {
    return createPromptVaultError('VALIDATION_ERROR', 'content is required');
  }
  if (input.content.length > CONTENT_MAX_LENGTH) {
    return createPromptVaultError(
      'VALIDATION_ERROR',
      `content must be at most ${String(CONTENT_MAX_LENGTH)} characters`
    );
  }
  return null;
}

/**
 * Execute the CreatePrompt use case.
 */
export async function createPrompt(
  repository: PromptRepository,
  input: CreatePromptUseCaseInput,
  deps: CreatePromptDeps
): Promise<Result<Prompt, PromptVaultError>> {
  const { logger } = deps;

  logger.debug({ userId: input.userId, title: input.title }, 'Creating prompt');

  const validationError = validateInput(input);
  if (validationError !== null) {
    logger.warn(
      { userId: input.userId, errorCode: validationError.code },
      'Prompt validation failed'
    );
    return err(validationError);
  }

  const result = await repository.createPrompt(input.userId, {
    title: input.title,
    content: input.content,
  });

  if (!result.ok) {
    logger.error(
      { userId: input.userId, errorMessage: result.error.message },
      'Failed to create prompt'
    );
    return result;
  }

  logger.info({ userId: input.userId, promptId: result.value.id }, 'Prompt created successfully');
  return result;
}

/**
 * Factory to create a bound CreatePrompt use case.
 */
export function createCreatePromptUseCase(
  repository: PromptRepository,
  logger: Logger
): (input: CreatePromptUseCaseInput) => Promise<Result<Prompt, PromptVaultError>> {
  return async (input) => await createPrompt(repository, input, { logger });
}
