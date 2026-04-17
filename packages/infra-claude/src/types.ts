/**
 * Types for the Anthropic Claude client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';

import type { OwnerType } from '@intexuraos/llm-contract';

export type {
  LLMError as ClaudeError,
  ResearchResult,
  GenerateResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating a Claude client.
 *
 * @example
 * ```ts
 * import { createClaudeClient } from '@intexuraos/infra-claude';
 *
 * const client = createClaudeClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-sonnet-4-5',
 *   userId: 'user-123',
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
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
  /** Optional research ID for correlating audit logs to a research run */
  researchId?: string;
  /** Pino logger for structured LLM usage logging */
  logger: Logger;
  /** Usage sink. Required — pass NoopUsageSink to explicitly opt out. */
  usageSink: UsageSink;
  /** Owner scope of the call. When omitted, the usage sink defaults to 'system'. */
  ownerType?: OwnerType;
}
