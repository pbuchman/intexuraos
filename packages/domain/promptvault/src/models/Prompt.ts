/**
 * Prompt domain model.
 * Represents a prompt stored in the PromptVault.
 */

/**
 * Unique identifier for a prompt.
 */
export type PromptId = string;

/**
 * Domain model for a Prompt in the PromptVault.
 */
export interface Prompt {
  /** Unique identifier (maps to storage system's ID) */
  id: PromptId;
  /** Human-readable title */
  title: string;
  /** The prompt content/text */
  content: string;
  /** ISO timestamp when created (if available) */
  createdAt?: string | undefined;
  /** ISO timestamp when last updated (if available) */
  updatedAt?: string | undefined;
}

/**
 * Input for creating a new prompt.
 */
export interface CreatePromptInput {
  title: string;
  content: string;
}

/**
 * Input for updating an existing prompt.
 * At least one field must be provided.
 */
export interface UpdatePromptInput {
  title?: string | undefined;
  content?: string | undefined;
}
