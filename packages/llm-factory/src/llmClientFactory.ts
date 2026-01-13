/**
 * LLM Client Factory
 *
 * Provides a unified interface for creating LLM clients
 * across different providers (Gemini, GLM, etc.).
 *
 * @packageDocumentation
 *
 * @remarks
 * This factory abstracts away the provider-specific client creation,
 * allowing apps to switch between LLM providers using a single interface.
 *
 * @example
 * ```ts
 * import { createLlmClient } from '@intexuraos/llm-factory';
 *
 * const client = createLlmClient({
 *   apiKey: 'sk-...',
 *   model: 'gemini-2.5-flash',
 *   userId: 'user-123',
 *   pricing: { inputPricePerMillion: 0.3, outputPricePerMillion: 2.5 },
 * });
 *
 * const result = await client.generate('Write a poem');
 * if (result.ok) {
 *   console.log(result.value.content);
 * }
 * ```
 */

import { createGeminiClient } from '@intexuraos/infra-gemini';
import { createGlmClient } from '@intexuraos/infra-glm';
import {
  getProviderForModel,
  LlmProviders,
  type LLMError,
  type LLMModel,
  type ModelPricing,
} from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';

/**
 * Configuration for creating an LLM client.
 */
export interface LlmClientConfig {
  /** API key for the LLM provider */
  apiKey: string;
  /** Model identifier (e.g., 'gemini-2.5-flash', 'glm-4.7') */
  model: LLMModel;
  /** User ID for usage tracking */
  userId: string;
  /** Pricing information for the model */
  pricing: ModelPricing;
}

/**
 * Result of a successful LLM generation.
 */
export interface GenerateResult {
  /** Generated text content */
  content: string;
  /** Usage statistics */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}

/**
 * Unified LLM client interface.
 * All provider clients implement this interface.
 */
export interface LlmGenerateClient {
  /**
   * Generate text using the LLM.
   * @param prompt - Text prompt to send to the LLM
   * @returns Result with content and usage, or error
   */
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
}

/**
 * Supported providers for the factory.
 */
type SupportedProvider = typeof LlmProviders.Google | typeof LlmProviders.Zhipu;

/**
 * Maps model to provider and creates the appropriate client.
 *
 * @param config - Client configuration
 * @returns LLM client instance
 * @throws Error if provider is not supported
 *
 * @example
 * ```ts
 * // Create Gemini client
 * const geminiClient = createLlmClient({
 *   apiKey: 'sk-...',
 *   model: 'gemini-2.5-flash',
 *   userId: 'user-123',
 *   pricing: getPricing('gemini-2.5-flash'),
 * });
 *
 * // Create GLM client
 * const glmClient = createLlmClient({
 *   apiKey: 'sk-...',
 *   model: 'glm-4.7',
 *   userId: 'user-123',
 *   pricing: getPricing('glm-4.7'),
 * });
 * ```
 */
export function createLlmClient(config: LlmClientConfig): LlmGenerateClient {
  const provider = getProviderForModel(config.model) as SupportedProvider;

  switch (provider) {
    case LlmProviders.Google:
      return createGeminiClient(config);
    case LlmProviders.Zhipu:
      return createGlmClient(config);
    default: {
      // This will be caught at compile time if new providers are added
      // without updating this factory
      const exhaustive: never = provider;
      throw new Error(`Unsupported LLM provider: ${String(exhaustive)}`);
    }
  }
}

/**
 * Type guard to check if a provider is supported by the factory.
 */
export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return provider === LlmProviders.Google || provider === LlmProviders.Zhipu;
}

// Re-export LLMError for convenience
export type { LLMError };
