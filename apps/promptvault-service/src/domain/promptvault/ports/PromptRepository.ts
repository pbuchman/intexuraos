/**
 * Port for prompt storage operations.
 * This is the main repository interface for the PromptVault domain.
 */
import type { Result } from '@intexuraos/common-core';
import type {
  CreatePromptInput,
  Prompt,
  PromptId,
  PromptVaultError,
  UpdatePromptInput,
} from '../models/index.js';

/**
 * Repository port for Prompt CRUD operations.
 * Implementations may use Notion, a database, or any other storage system.
 */
export interface PromptRepository {
  /**
   * Create a new prompt in the user's PromptVault.
   *
   * @param userId - The authenticated user's ID
   * @param input - Title and content for the new prompt
   * @returns The created prompt with its generated ID
   */
  createPrompt(userId: string, input: CreatePromptInput): Promise<Result<Prompt, PromptVaultError>>;

  /**
   * List all prompts in the user's PromptVault.
   *
   * @param userId - The authenticated user's ID
   * @returns Array of prompts (may be empty if none exist)
   */
  listPrompts(userId: string): Promise<Result<Prompt[], PromptVaultError>>;

  /**
   * Get a single prompt by ID.
   *
   * @param userId - The authenticated user's ID
   * @param promptId - The prompt's unique identifier
   * @returns The prompt, or NOT_FOUND error if it doesn't exist
   */
  getPrompt(userId: string, promptId: PromptId): Promise<Result<Prompt, PromptVaultError>>;

  /**
   * Update an existing prompt.
   *
   * @param userId - The authenticated user's ID
   * @param promptId - The prompt's unique identifier
   * @param input - Fields to update (at least one required)
   * @returns The updated prompt, or NOT_FOUND error if it doesn't exist
   */
  updatePrompt(
    userId: string,
    promptId: PromptId,
    input: UpdatePromptInput
  ): Promise<Result<Prompt, PromptVaultError>>;
}
