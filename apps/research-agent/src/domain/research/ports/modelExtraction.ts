/**
 * Port interfaces for model preference extraction.
 */

import type { Result } from '@intexuraos/common-core';

/**
 * API keys available to a user, keyed by provider.
 */
export interface ApiKeyStore {
  openai?: string;
  anthropic?: string;
  perplexity?: string;
  openrouter?: string;
}

/**
 * Error from text generation.
 */
export interface TextGenerationError {
  code: string;
  message: string;
}

/**
 * Result from text generation.
 */
export interface TextGenerationResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}

/**
 * Options for text generation.
 */
export interface TextGenerationOptions {
  /** Semantic identifier for the prompt type */
  promptType: string;
}

/**
 * Simple text generation client for model extraction.
 */
export interface TextGenerationClient {
  generate(prompt: string, options: TextGenerationOptions): Promise<Result<TextGenerationResult, TextGenerationError>>;
}
