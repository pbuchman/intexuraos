/**
 * Types for the OpenAI GPT client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';

import type { OwnerType } from '@intexuraos/llm-contract';

export type {
  LLMError as GptError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating a GPT client.
 *
 * @example
 * ```ts
 * import { createGptClient } from '@intexuraos/infra-gpt';
 *
 * const client = createGptClient({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4.1',
 *   userId: 'user-123',
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
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
  /** Optional research ID for correlating audit logs to a research run */
  researchId?: string;
  /** Pino logger for structured LLM usage logging */
  logger: Logger;
  /** Usage sink. Required — pass NoopUsageSink to explicitly opt out. */
  usageSink: UsageSink;
  /** Owner scope of the call. When omitted, the usage sink defaults to 'system'. */
  ownerType?: OwnerType;
}
