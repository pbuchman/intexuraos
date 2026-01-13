/**
 * Use case for updating an existing prompt.
 */
import { err, type Result } from '@intexuraos/common-core';
import type { Prompt, PromptId, PromptVaultError } from '../models/index.js';
import { createPromptVaultError } from '../models/index.js';
import type { PromptRepository } from '../ports/index.js';
import type { Logger } from '@intexuraos/common-core';

/**
 * Input for the UpdatePrompt use case.
 */
export interface UpdatePromptUseCaseInput {
  userId: string;
  promptId: PromptId;
  title?: string | undefined;
  content?: string | undefined;
}

/**
 * Dependencies for the UpdatePrompt use case.
 */
export interface UpdatePromptDeps {
  logger: Logger;
}

/**
 * Validation constraints for prompt updates.
 */
const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 100000;

/**
 * Validate input for updating a prompt.
 */
function validateInput(input: UpdatePromptUseCaseInput): PromptVaultError | null {
  if (input.promptId.trim().length === 0) {
    return createPromptVaultError('VALIDATION_ERROR', 'promptId is required');
  }

  // At least one field must be provided
  if (input.title === undefined && input.content === undefined) {
    return createPromptVaultError(
      'VALIDATION_ERROR',
      'at least one of title or content must be provided'
    );
  }

  // Validate title if provided
  if (input.title !== undefined) {
    if (input.title.trim().length === 0) {
      return createPromptVaultError('VALIDATION_ERROR', 'title cannot be empty');
    }
    if (input.title.length > TITLE_MAX_LENGTH) {
      return createPromptVaultError(
        'VALIDATION_ERROR',
        `title must be at most ${String(TITLE_MAX_LENGTH)} characters`
      );
    }
  }

  // Validate content if provided
  if (input.content !== undefined) {
    if (input.content.trim().length === 0) {
      return createPromptVaultError('VALIDATION_ERROR', 'content cannot be empty');
    }
    if (input.content.length > CONTENT_MAX_LENGTH) {
      return createPromptVaultError(
        'VALIDATION_ERROR',
        `content must be at most ${String(CONTENT_MAX_LENGTH)} characters`
      );
    }
  }

  return null;
}

/**
 * Execute the UpdatePrompt use case.
 */
export async function updatePrompt(
  repository: PromptRepository,
  input: UpdatePromptUseCaseInput,
  deps: UpdatePromptDeps
): Promise<Result<Prompt, PromptVaultError>> {
  const { logger } = deps;

  logger.debug({ userId: input.userId, promptId: input.promptId }, 'Updating prompt');

  const validationError = validateInput(input);
  if (validationError !== null) {
    logger.warn(
      { userId: input.userId, promptId: input.promptId, errorCode: validationError.code },
      'Prompt validation failed'
    );
    return err(validationError);
  }

  const result = await repository.updatePrompt(input.userId, input.promptId, {
    title: input.title,
    content: input.content,
  });

  if (!result.ok) {
    logger.error(
      { userId: input.userId, promptId: input.promptId, errorMessage: result.error.message },
      'Failed to update prompt'
    );
    return result;
  }

  logger.info({ userId: input.userId, promptId: input.promptId }, 'Prompt updated successfully');
  return result;
}

/**
 * Factory to create a bound UpdatePrompt use case.
 */
export function createUpdatePromptUseCase(
  repository: PromptRepository,
  logger: Logger
): (input: UpdatePromptUseCaseInput) => Promise<Result<Prompt, PromptVaultError>> {
  return async (input) => await updatePrompt(repository, input, { logger });
}
