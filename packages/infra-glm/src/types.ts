/**
 * Types for the Zai GLM client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';

export type {
  LLMError as GlmError,
  ResearchResult,
  GenerateResult,
  SynthesisInput,
  ModelPricing,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating a GLM client.
 *
 * Extends {@link LLMConfig} with Zai-specific pricing configuration.
 * GLM-4.7 supports web search research via the built-in web search tool.
 *
 * @example
 * ```ts
 * import { createGlmClient } from '@intexuraos/infra-glm';
 *
 * const client = createGlmClient({
 *   apiKey: process.env.GLM_API_KEY,
 *   model: 'glm-4.7',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 0.60,
 *     outputPricePerMillion: 2.20,
 *     webSearchCostPerCall: 0.005,
 *   },
 *   logger: pinoLogger, // Optional pino logger for structured logging
 * });
 * ```
 */
export interface GlmConfig {
  /** Zai GLM API key from open.bigmodel.cn */
  apiKey: string;
  /** Model identifier (e.g., 'glm-4.7') */
  model: string;
  /** User ID for usage tracking and analytics */
  userId: string;
  /** Cost configuration per million tokens */
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  /** Optional pino logger for structured LLM usage logging */
  logger?: Logger;
}
