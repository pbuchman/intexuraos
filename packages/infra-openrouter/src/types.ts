/**
 * Types for the OpenRouter client implementation.
 *
 * @packageDocumentation
 */

import type { Logger } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type { MatrixCorpusLlmCallContextV1, OwnerType } from '@intexuraos/llm-contract';

export type {
  LLMError as OpenRouterError,
  ResearchResult,
  GenerateResult,
  LlmChatRole,
  LlmChatTextBlock,
  LlmChatMessage,
  GenerateChatOptions,
  GenerateChatReasoningEffort,
  GenerateChatReasoningOptions,
  GenerateChatResult,
  GenerateChatStreamEvent,
} from '@intexuraos/llm-contract';

/**
 * Options for the generate method.
 */
export interface GenerateOptions {
  /** Request a specific response format from the model (e.g., JSON mode). */
  responseFormat?: { type: 'json_object' | 'text' };
  /** Semantic identifier for what the prompt was used for (e.g., 'linear-issue-title', 'code-worker-validation') */
  promptType: string;
  /**
   * Optional per-call correlation overrides. Forwarded to the usage sink
   * so the emitted event carries researchId / sessionId / taskId /
   * requestId for the originating request.
   */
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
  matrixCorpusContext?: MatrixCorpusLlmCallContextV1;
}

/**
 * Per-call options for the research method. Currently only carries
 * correlation overrides so the emitted usage event can be attributed to the
 * originating researchId / sessionId / taskId / requestId.
 */
export interface ResearchOptions {
  /** Semantic identifier for what the research prompt was used for. */
  promptType?: string;
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
}

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
 *   logger: pinoLogger,
 *   usageSink: myUsageSink,
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
  /** Request timeout in milliseconds. Default: 840000 (14 minutes) */
  timeoutMs?: number;
  /** Pino logger for structured LLM usage logging */
  logger: Logger;
  /** Usage sink. Required — pass NoopUsageSink to explicitly opt out. */
  usageSink: UsageSink;
  /** Owner scope of the call. When omitted, the usage sink defaults to 'system'. */
  ownerType?: OwnerType;
  /** Canonical model ID persisted in Matrix corpus evidence. */
  evidenceModelId?: string;
  /** OpenRouter-specific provider routing constraints. */
  providerRouting?: {
    /** Route only to providers that support every supplied request parameter. */
    requireParameters?: boolean;
    /** Provider slugs in preferred routing order. */
    order?: readonly string[];
    /** Whether OpenRouter may route outside the configured provider order. */
    allowFallbacks?: boolean;
  };
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
  cost?: number; // OpenRouter reports USD cost per request (always present per docs, optional for back-compat)
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
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
      content: unknown;
      role: string;
    };
    finish_reason: string;
    error?: unknown;
  }[];
  usage?: OpenRouterUsage;
  annotations?: (string | { url?: string })[];
}
