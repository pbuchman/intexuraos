/**
 * Port interfaces for model preference extraction.
 */

import type { Result } from '@intexuraos/common-core';

/**
 * API keys available to a user, keyed by provider.
 */
export interface ApiKeyStore {
  google?: string;
  openai?: string;
  anthropic?: string;
  perplexity?: string;
  zai?: string;
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
 * Simple text generation client for model extraction.
 */
export interface TextGenerationClient {
  generate(prompt: string): Promise<Result<TextGenerationResult, TextGenerationError>>;
}
