/**
 * Types for the Perplexity AI client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type { OwnerType } from '@intexuraos/llm-contract';

export type {
  LLMError as PerplexityError,
  ResearchResult,
  GenerateResult,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating a Perplexity client.
 *
 * Perplexity provides online search capabilities with their Sonar models.
 *
 * @example
 * ```ts
 * import { createPerplexityClient } from '@intexuraos/infra-perplexity';
 *
 * const client = createPerplexityClient({
 *   apiKey: process.env.PERPLEXITY_API_KEY,
 *   model: 'sonar-pro',
 *   userId: 'user-123',
 *   timeoutMs: 840000, // 14 minutes
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
 * });
 * ```
 */
export interface PerplexityConfig {
  /** Perplexity API key from perplexity.ai */
  apiKey: string;
  /** Model identifier (e.g., 'sonar', 'sonar-pro', 'sonar-deep-research') */
  model: string;
  /** User ID for usage tracking and analytics */
  userId: string;
  /** Request timeout in milliseconds. Default: 840000 (14 minutes) */
  timeoutMs?: number;
  /** Pino logger for structured LLM usage logging */
  logger: Logger;
  /** Usage sink. Required — pass NoopUsageSink to explicitly opt out. */
  usageSink: UsageSink;
  /** Owner scope of the call. When omitted, the usage sink defaults to 'system'. */
  ownerType?: OwnerType;
}

/** Search context size for Perplexity requests */
export type SearchContextSize = 'low' | 'medium' | 'high';

/** Request body format for Perplexity API */
export interface PerplexityRequestBody {
  model: string;
  messages: {
    role: 'system' | 'user';
    content: string;
  }[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/** Search result metadata from Perplexity */
export interface PerplexitySearchResult {
  title?: string;
  url?: string;
  date?: string;
}

/** Cost breakdown reported by Perplexity */
export interface PerplexityCost {
  input_tokens_cost?: number;
  output_tokens_cost?: number;
  request_cost?: number;
  total_cost?: number;
}

/** Usage information from Perplexity response */
export interface PerplexityUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  citation_tokens?: number;
  reasoning_tokens?: number;
  search_context_size?: SearchContextSize;
  cost?: PerplexityCost;
}

/** Full Perplexity API response structure */
export interface PerplexityResponse {
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
  usage?: PerplexityUsage;
  search_results?: PerplexitySearchResult[];
}
