/**
 * Types for the OpenAI GPT client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';

export type {
  LLMError as GptError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
  ModelPricing,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating a GPT client.
 *
 * Extends {@link LLMConfig} with OpenAI-specific pricing configuration.
 * Supports both text generation and image generation with separate pricing.
 *
 * @example
 * ```ts
 * import { createGptClient } from '@intexuraos/infra-gpt';
 *
 * const client = createGptClient({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4.1',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 2.50,
 *     outputPricePerMillion: 10.00,
 *   },
 *   imagePricing: {
 *     inputPricePerMillion: 0,
 *     outputPricePerMillion: 0,
 *     imagePricing: {
 *       '1024x1024': 0.040,
 *       '1536x1024': 0.050,
 *       '1024x1536': 0.050,
 *     }
 *   },
 *   logger: pinoLogger, // Optional pino logger for structured logging
 * });
 * ```
 */
export interface GptConfig {
  /** OpenAI API key from platform.openai.com */
  apiKey: string;
  /** Model identifier (e.g., 'gpt-4.1', 'gpt-4o-mini', 'o4-mini-deep-research') */
  model: string;
  /** User ID for usage tracking and analytics */
  userId: string;
  /** Cost configuration per million tokens for text operations */
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  /** Optional separate pricing for image generation */
  imagePricing?: import('@intexuraos/llm-contract').ModelPricing;
  /** Optional pino logger for structured LLM usage logging */
  logger?: Logger;
}
