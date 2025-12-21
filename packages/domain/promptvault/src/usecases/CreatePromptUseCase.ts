/**
 * Use case for creating a new prompt in the PromptVault.
 */
import { err, type Result } from '@praxos/common';
import type { Prompt } from '../models/Prompt.js';
import { createPromptVaultError, type PromptVaultError } from '../models/PromptVaultError.js';
import type { PromptRepository } from '../ports/PromptRepository.js';

/**
 * Input for the CreatePrompt use case.
 */
export interface CreatePromptUseCaseInput {
  userId: string;
  title: string;
  content: string;
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
  input: CreatePromptUseCaseInput
): Promise<Result<Prompt, PromptVaultError>> {
  const validationError = validateInput(input);
  if (validationError !== null) {
    return err(validationError);
  }

  return await repository.createPrompt(input.userId, {
    title: input.title,
    content: input.content,
  });
}

/**
 * Factory to create a bound CreatePrompt use case.
 */
export function createCreatePromptUseCase(
  repository: PromptRepository
): (input: CreatePromptUseCaseInput) => Promise<Result<Prompt, PromptVaultError>> {
  return async (input) => await createPrompt(repository, input);
}
