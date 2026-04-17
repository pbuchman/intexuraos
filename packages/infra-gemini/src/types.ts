/**
 * Types for the Google Gemini client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';

import type { OwnerType } from '@intexuraos/llm-contract';

export type {
  LLMError as GeminiError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating a Gemini client.
 *
 * @example
 * ```ts
 * import { createGeminiClient } from '@intexuraos/infra-gemini';
 *
 * const client = createGeminiClient({
 *   apiKey: process.env.GOOGLE_API_KEY,
 *   model: 'gemini-2.5-flash',
 *   userId: 'user-123',
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 * ```
 */
export interface GeminiConfig {
  /** Google API key from console.cloud.google.com */
  apiKey: string;
  /** Model identifier (e.g., 'gemini-2.5-pro', 'gemini-2.5-flash') */
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
