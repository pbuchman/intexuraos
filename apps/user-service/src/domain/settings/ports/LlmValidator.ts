/**
 * Port interface for validating and testing LLM API keys.
 * Implementations handle the actual API calls to different providers.
 */
import type { Result } from '@intexuraos/common-core';
import type { LlmProvider } from '../models/UserSettings.js';

/**
 * Error types for LLM validation operations.
 */
export interface LlmValidationError {
  code: 'INVALID_KEY' | 'API_ERROR' | 'UNKNOWN_PROVIDER';
  message: string;
}

/**
 * Result of a test request to an LLM provider.
 */
export interface LlmTestResponse {
  content: string;
}

/**
 * Port for LLM API key validation and testing.
 */
export interface LlmValidator {
  /**
   * Validate an API key by making a minimal request to the provider.
   * Returns success if the key is valid, error otherwise.
   */
  validateKey(
    provider: LlmProvider,
    apiKey: string,
    userId: string
  ): Promise<Result<void, LlmValidationError>>;

  /**
   * Make a test request to the provider with a sample prompt.
   * Returns the model's response content.
   */
  testRequest(
    provider: LlmProvider,
    apiKey: string,
    prompt: string,
    userId: string
  ): Promise<Result<LlmTestResponse, LlmValidationError>>;
}
