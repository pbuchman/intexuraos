/**
 * Use case for listing all prompts in the PromptVault.
 */
import type { Result } from '@praxos/common';
import type { Prompt } from '../models/Prompt.js';
import type { PromptVaultError } from '../models/PromptVaultError.js';
import type { PromptRepository } from '../ports/PromptRepository.js';

/**
 * Input for the ListPrompts use case.
 */
export interface ListPromptsUseCaseInput {
  userId: string;
}

/**
 * Execute the ListPrompts use case.
 */
export async function listPrompts(
  repository: PromptRepository,
  input: ListPromptsUseCaseInput
): Promise<Result<Prompt[], PromptVaultError>> {
  return await repository.listPrompts(input.userId);
}

/**
 * Factory to create a bound ListPrompts use case.
 */
export function createListPromptsUseCase(
  repository: PromptRepository
): (input: ListPromptsUseCaseInput) => Promise<Result<Prompt[], PromptVaultError>> {
  return async (input) => await listPrompts(repository, input);
}
