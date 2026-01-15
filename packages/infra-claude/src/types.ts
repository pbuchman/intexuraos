/**
 * Types for the Anthropic Claude client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';

export type {
  LLMError as ClaudeError,
  ResearchResult,
  GenerateResult,
  SynthesisInput,
  ModelPricing,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating a Claude client.
 *
 * Extends {@link LLMConfig} with Anthropic-specific pricing configuration.
 *
 * @example
 * ```ts
 * import { createClaudeClient } from '@intexuraos/infra-claude';
 *
 * const client = createClaudeClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-sonnet-4-5',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 3.00,
 *     outputPricePerMillion: 15.00,
 *     cacheReadMultiplier: 0.1,
 *     cacheWriteMultiplier: 1.25,
 *     webSearchCostPerCall: 0.0035,
 *   },
 *   logger: pinoLogger, // Optional pino logger for structured logging
 * });
 * ```
 */
export interface ClaudeConfig {
  /** Anthropic API key from console.anthropic.com */
  apiKey: string;
  /** Model identifier (e.g., 'claude-sonnet-4-5', 'claude-haiku-3-5') */
  model: string;
  /** User ID for usage tracking and analytics */
  userId: string;
  /** Cost configuration per million tokens */
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  /** Pino logger for structured LLM usage logging */
  logger: Logger;
}
