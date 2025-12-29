/**
 * Use case for getting a single prompt by ID.
 */
import { err, type Result } from '@intexuraos/common-core';
import type { Prompt, PromptId, PromptVaultError } from '../models/index.js';
import { createPromptVaultError } from '../models/index.js';
import type { PromptRepository } from '../ports/index.js';

/**
 * Input for the GetPrompt use case.
 */
export interface GetPromptUseCaseInput {
  userId: string;
  promptId: PromptId;
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
  input: GetPromptUseCaseInput
): Promise<Result<Prompt, PromptVaultError>> {
  const validationError = validateInput(input);
  if (validationError !== null) {
    return err(validationError);
  }

  return await repository.getPrompt(input.userId, input.promptId);
}

/**
 * Factory to create a bound GetPrompt use case.
 */
export function createGetPromptUseCase(
  repository: PromptRepository
): (input: GetPromptUseCaseInput) => Promise<Result<Prompt, PromptVaultError>> {
  return async (input) => await getPrompt(repository, input);
}
