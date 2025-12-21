/**
 * Use case for getting a single prompt by ID.
 */
import { err, type Result } from '@praxos/common';
import type { Prompt, PromptId } from '../models/Prompt.js';
import { createPromptVaultError, type PromptVaultError } from '../models/PromptVaultError.js';
import type { PromptRepository } from '../ports/PromptRepository.js';

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
