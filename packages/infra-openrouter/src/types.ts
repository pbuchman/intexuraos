/**
 * Types for the OpenRouter client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';

export type {
  LLMError as OpenRouterError,
  ResearchResult,
  GenerateResult,
  ModelPricing,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating an OpenRouter client.
 *
 * OpenRouter provides access to multiple frontier models from various providers
 * through a unified API, with built-in web search via :online suffix.
 *
 * @example
 * ```ts
 * import { createOpenRouterClient } from '@intexuraos/infra-openrouter';
 *
 * const client = createOpenRouterClient({
 *   apiKey: process.env.OPENROUTER_API_KEY,
 *   model: 'anthropic/claude-sonnet-4.6',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 3.0,
 *     outputPricePerMillion: 15.0,
 *     useProviderCost: true,
 *   },
 *   logger: pinoLogger,
 * });
 * ```
 */
export interface OpenRouterConfig {
  /** OpenRouter API key from openrouter.ai */
  apiKey: string;
  /** Model identifier (e.g., 'anthropic/claude-sonnet-4.6') */
  model: string;
  /** User ID for usage tracking and analytics */
  userId: string;
  /** Optional research ID for correlating audit logs to a research run */
  researchId?: string;
  /** Cost configuration per million tokens */
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  /** Request timeout in milliseconds. Default: 840000 (14 minutes) */
  timeoutMs?: number;
  /** Pino logger for structured LLM usage logging */
  logger: Logger;
}

/**
 * OpenRouter model information with pricing and capabilities.
 */
export interface OpenRouterModelInfo {
  /** Model ID (e.g., 'anthropic/claude-sonnet-4.6') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider name (e.g., 'Anthropic') */
  provider: string;
  /** Context window size in tokens */
  contextLength: number;
  /** Pricing information */
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  /** Supported input modalities */
  inputModalities: ('text' | 'image')[];
  /** Supported output modalities */
  outputModalities: ('text' | 'image')[];
}

/**
 * OpenRouter API key validation response.
 */
export interface OpenRouterKeyInfo {
  token: string;
  usage: number;
  limit: number | null;
  expiresAt: string | null;
}

/**
 * Usage information from OpenRouter response.
 */
export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Full OpenRouter API response structure.
 */
export interface OpenRouterResponse {
  id: string;
  model: string;
  created: number;
  object: string;
  choices: {
    index: number;
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }[];
  usage?: OpenRouterUsage;
  annotations?: (string | { url?: string })[];
}
