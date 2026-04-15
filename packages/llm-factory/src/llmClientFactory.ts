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
import type { UsageSink } from '@intexuraos/llm-pricing';
import {
  getProviderForModel,
  isOpenRouterModel,
  isValidModel,
  LlmProviders,
  type LLMError,
  type LLMModel,
  type ModelPricing,
  type ToolCallingClient,
  type OwnerType,
} from '@intexuraos/llm-contract';
import { createOpenRouterGenerateClient } from './openRouterGenerateClient.js';
import type { Logger, Result } from '@intexuraos/common-core';

const ZERO_PRICING: ModelPricing = { inputPricePerMillion: 0, outputPricePerMillion: 0 };

/**
 * Configuration for creating an LLM client.
 */
export interface LlmClientConfig {
  /** API key for the LLM provider */
  apiKey: string;
  /** Model identifier (e.g., 'gemini-2.5-flash') */
  model: LLMModel;
  /** User ID for usage tracking */
  userId: string;
  /** When omitted, defaults to zero-cost pricing (costs computed server-side by llm-usage-service). */
  pricing?: ModelPricing;
  /** Logger for structured LLM usage logging */
  logger: Logger;
  /** Usage sink. Required — pass NoopUsageSink to explicitly opt out. */
  usageSink: UsageSink;
  /**
   * Owner scope of the call.
   * When omitted, downstream defaults to 'system' to preserve legacy behavior.
   * Pass 'user' for calls initiated directly by a human (e.g. chat, code tasks).
   */
  ownerType?: OwnerType;
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
 * App-side: Google (Gemini) and OpenRouter are supported.
 */
type SupportedProvider = typeof LlmProviders.Google | typeof LlmProviders.OpenRouter;

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
 * });
 * ```
 */
export function createLlmClient(config: LlmClientConfig): LlmGenerateClient {
  const model = config.model as string;

  // OpenRouter models (or: prefix) are routed to the OpenRouter client
  if (isOpenRouterModel(model)) {
    return createOpenRouterGenerateClient({ ...config, pricing: config.pricing ?? ZERO_PRICING });
  }

  // Validate model is a known static model
  if (!isValidModel(config.model)) {
    throw new Error(`Unsupported LLM model: ${model}`);
  }

  // Static models: check provider
  const providerForModel = getProviderForModel(config.model);
  if (providerForModel !== LlmProviders.Google) {
    throw new Error(
      `Unsupported LLM provider: ${providerForModel}. Only ${LlmProviders.Google} is supported.`
    );
  }

  return createGeminiClient({ ...config, pricing: config.pricing ?? ZERO_PRICING });
}

/**
 * Type guard to check if a provider is supported by the factory.
 */
export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return provider === LlmProviders.Google || provider === LlmProviders.OpenRouter;
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

  // Verify provider is Google (only supported provider for tool calling)
  const providerForModel = getProviderForModel(config.model);
  if (providerForModel !== LlmProviders.Google) {
    throw new Error(
      `Tool calling not supported for provider: ${providerForModel}. Only ${LlmProviders.Google} is supported.`
    );
  }

  return createGeminiToolCallingClient(config);
}

// Re-export for convenience
export type { LLMError, ToolCallingClientConfig };
