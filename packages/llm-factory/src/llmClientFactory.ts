/**
 * LLM Client Factory
 *
 * Provides a unified interface for creating LLM clients
 * across different providers (Gemini).
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
import {
  createGeminiToolCallingClient,
  type ToolCallingClientConfig,
} from '@intexuraos/infra-gemini';
import type { AuditSink } from '@intexuraos/llm-audit';
import type { UsageSink } from '@intexuraos/llm-pricing';
import {
  getProviderForModel,
  isValidModel,
  LlmProviders,
  type LLMError,
  type LLMModel,
  type ModelPricing,
  type ToolCallingClient,
} from '@intexuraos/llm-contract';
import type { Logger, Result } from '@intexuraos/common-core';

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
  /** Logger for structured LLM usage logging */
  logger: Logger;
  /** Optional audit sink override (defaults to Firestore audit sink) */
  auditSink?: AuditSink;
  /** Optional usage sink override (defaults to Firestore usage sink) */
  usageSink?: UsageSink;
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
 * App-side: only Google (Gemini) is supported.
 */
type SupportedProvider = typeof LlmProviders.Google;

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
 * ```
 */
export function createLlmClient(config: LlmClientConfig): LlmGenerateClient {
  // Validate model is supported
  if (!isValidModel(config.model)) {
    const model = config.model as string;
    throw new Error(`Unsupported LLM model: ${model}`);
  }

  // Check provider first, before model validation
  const provider = LlmProviders.Google;
  const providerForModel = getProviderForModel(config.model);
  if (providerForModel !== provider) {
    throw new Error(
      `Unsupported LLM provider: ${providerForModel}. Only ${provider} is supported.`
    );
  }

  return createGeminiClient(config);
}

/**
 * Type guard to check if a provider is supported by the factory.
 */
export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return provider === LlmProviders.Google;
}

/**
 * Create a tool calling client for LLM agent loops.
 *
 * Routes to the appropriate provider-specific tool calling implementation.
 * Currently supports Google (Gemini) only.
 *
 * @param config - Tool calling client configuration
 * @returns ToolCallingClient instance
 */
export function createToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient {
  // Validate model is supported
  if (!isValidModel(config.model)) {
    const model = config.model as string;
    throw new Error(`Unsupported LLM model: ${model}`);
  }

  return createGeminiToolCallingClient(config);
}

// Re-export for convenience
export type { LLMError, ToolCallingClientConfig };
