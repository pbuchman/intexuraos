/**
 * LLM Contract Types.
 *
 * Common types and interfaces for LLM client implementations.
 *
 * @packageDocumentation
 */

import type { Result } from '@intexuraos/common-core';
import type { LLMModel } from './supportedModels.js';

/**
 * Base configuration for LLM clients.
 *
 * Extended by provider-specific configs (e.g., {@link ClaudeConfig}, {@link GptConfig})
 * which add provider-specific pricing information.
 */
export interface LLMConfig {
  /** API key for the LLM provider */
  apiKey: string;
  /** Model identifier from {@link LlmModels} */
  model: LLMModel;
  /** User ID for usage tracking and analytics */
  userId: string;
}

/**
 * Raw token usage from providers (provider-specific fields).
 *
 * Used internally by clients before normalization into {@link NormalizedUsage}.
 * Different providers return different fields, so this interface captures
 * all possible usage metrics.
 */
export interface TokenUsage {
  /** Number of tokens in the input prompt */
  inputTokens: number;
  /** Number of tokens in the generated output */
  outputTokens: number;
  /** Anthropic: tokens written to prompt cache (billed at higher rate) */
  cacheCreationTokens?: number;
  /** Anthropic: tokens read from prompt cache (billed at lower rate) */
  cacheReadTokens?: number;
  /** OpenAI: cached tokens from previous turns (combined read+write) */
  cachedTokens?: number;
  /** OpenAI: tokens used for extended reasoning (o1 models) */
  reasoningTokens?: number;
  /** Number of web search tool calls made (research operations) */
  webSearchCalls?: number;
  /** Google: whether grounding was enabled for the request */
  groundingEnabled?: boolean;
  /** Cost reported by provider (when available) */
  providerCost?: number;
}

/**
 * Normalized usage - standardized across all providers.
 *
 * Returned by all client methods. All costs are pre-calculated in USD.
 * Token counts and costs are aggregated regardless of provider-specific differences.
 */
export interface NormalizedUsage {
  /** Number of tokens in the input prompt */
  inputTokens: number;
  /** Number of tokens in the generated output */
  outputTokens: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** Calculated cost in USD based on pricing configuration */
  costUsd: number;
  /** Prompt cache tokens (lower billing rate) */
  cacheTokens?: number;
  /** Tokens used for extended reasoning (o1 models) */
  reasoningTokens?: number;
  /** Number of web search tool calls made (research only) */
  webSearchCalls?: number;
  /** Whether Google grounding was enabled (Gemini only) */
  groundingEnabled?: boolean;
}

/**
 * Result from a research operation with web search.
 *
 * Research uses the provider's built-in web search capability to find
 * current information and returns sources alongside the generated content.
 */
export interface ResearchResult {
  /** The research response content */
  content: string;
  /** URLs or citations from web search results */
  sources: string[];
  /** Token usage and cost information */
  usage: NormalizedUsage;
}

/**
 * Result from a simple text generation operation.
 *
 * Generate operations do not use web search - they complete based on
 * the model's training data only.
 */
export interface GenerateResult {
  /** The generated text content */
  content: string;
  /** Token usage and cost information */
  usage: NormalizedUsage;
}

/**
 * Result from an image generation operation.
 *
 * Contains the raw image data as a Buffer, suitable for saving to disk
 * or uploading to storage.
 */
export interface ImageGenerationResult {
  /** Raw image data (PNG format) */
  imageData: Buffer;
  /** The model used for generation (e.g., 'gpt-image-1') */
  model: string;
  /** Cost information for the generation */
  usage: NormalizedUsage;
}

/**
 * Options for image generation.
 *
 * Controls the output dimensions and optional metadata for image requests.
 */
export interface ImageGenerateOptions {
  /** Output dimensions (default: '1024x1024') */
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  /** Optional slug for tracking/reference */
  slug?: string;
}

/**
 * Input for content synthesis operations.
 *
 * Used when combining or synthesizing content from multiple sources.
 */
export interface SynthesisInput {
  /** Model identifier used for generation */
  model: string;
  /** The content to be synthesized */
  content: string;
}

/**
 * Error codes that can be returned by LLM client operations.
 *
 * @remarks
 * All errors are returned as {@link LLMError} objects with a `code` and `message`.
 * Use pattern matching to handle different error cases appropriately.
 *
 * @example
 * ```ts
 * const result = await client.generate('Explain TypeScript');
 * if (!result.ok) {
 *   switch (result.error.code) {
 *     case 'RATE_LIMITED':
 *       // Implement exponential backoff retry
 *       await sleep(1000);
 *       break;
 *     case 'CONTEXT_LENGTH':
 *       // Truncate prompt and retry
 *       return await client.generate(prompt.slice(0, -1000));
 *     case 'INVALID_KEY':
 *       // Log configuration error
 *       logger.error('Invalid API key configured');
 *       throw result.error;
 *     default:
 *       // Log and re-throw
 *       logger.error('LLM error', result.error);
 *       throw result.error;
 *   }
 * }
 * ```
 *
 * @see {@link LLMError}
 */
export type LLMErrorCode =
  /** General API error - check `message` for provider-specific details */
  | 'API_ERROR'
  /** Request timed out - retry with exponential backoff */
  | 'TIMEOUT'
  /** API key is invalid or not provided */
  | 'INVALID_KEY'
  /** Rate limit exceeded - implement backoff retry */
  | 'RATE_LIMITED'
  /** Provider API is overloaded - retry after delay */
  | 'OVERLOADED'
  /** Prompt exceeds model's context window */
  | 'CONTEXT_LENGTH'
  /** Content was filtered by provider safety systems */
  | 'CONTENT_FILTERED';
/**
 * Error object returned when LLM operations fail.
 *
 * @remarks
 * The `message` field contains provider-specific error details that can be
 * useful for debugging. The `code` field allows for programmatic error handling.
 *
 * @example
 * ```ts
 * if (!result.ok) {
 *   console.error(`${result.error.code}: ${result.error.message}`);
 * }
 * ```
 */
export interface LLMError {
  /** Machine-readable error code for programmatic handling */
  code: LLMErrorCode;
  /** Human-readable error message with provider details */
  message: string;
}

/**
 * LLM Client interface.
 *
 * All LLM provider implementations (Claude, GPT, Gemini, Perplexity) implement
 * this interface, enabling easy provider switching without changing application code.
 *
 * @remarks
 * All methods return a {@link Result} type which is either `ok` (success) or
 * contains an {@link LLMError}. This pattern forces explicit error handling.
 *
 * @example
 * ```ts
 * // Research with web search
 * const researchResult = await client.research('Latest TypeScript features');
 * if (researchResult.ok) {
 *   console.log(researchResult.data.content);
 *   console.log('Sources:', researchResult.data.sources);
 * }
 *
 * // Simple generation
 * const result = await client.generate('Explain TypeScript in one sentence');
 * if (result.ok) {
 *   console.log(result.data.content);
 * } else {
 *   console.error(result.error.code, result.error.message);
 * }
 * ```
 *
 * @see {@link ResearchResult}
 * @see {@link GenerateResult}
 * @see {@link ImageGenerationResult}
 */
export interface LLMClient {
  /**
   * Performs research using the provider's built-in web search capability.
   *
   * Returns current information with source citations. Cost includes both
   * generation and web search tool calls.
   *
   * @param prompt - The research query
   * @returns Promise resolving to {@link ResearchResult} or {@link LLMError}
   */
  research(prompt: string): Promise<Result<ResearchResult, LLMError>>;

  /**
   * Generates text completion without web search.
   *
   * Uses only the model's training data. Faster and cheaper than research.
   *
   * @param prompt - The input prompt for generation
   * @returns Promise resolving to {@link GenerateResult} or {@link LLMError}
   */
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;

  /**
   * Generates an image from a text description.
   *
   * Optional - only supported by providers with image generation capabilities.
   *
   * @param prompt - The image description
   * @param options - Optional image generation settings
   * @returns Promise resolving to {@link ImageGenerationResult} or {@link LLMError}
   */
  generateImage?(
    prompt: string,
    options?: ImageGenerateOptions
  ): Promise<Result<ImageGenerationResult, LLMError>>;
}
