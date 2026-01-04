/**
 * LLM Contract Types.
 *
 * Common types and interfaces for LLM client implementations.
 */

import type { Result } from '@intexuraos/common-core';

export interface LLMConfig {
  apiKey: string;
  model: string;
  usageLogger?: UsageLogger;
  userId?: string;
}

/**
 * Raw token usage from providers (provider-specific fields).
 * Used internally by clients before normalization.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  groundingEnabled?: boolean;
  providerCost?: number;
}

/**
 * Normalized usage - standardized across all providers.
 * Returned by all client methods.
 */
export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  cacheTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  groundingEnabled?: boolean;
}

export interface ResearchResult {
  content: string;
  sources: string[];
  usage: NormalizedUsage;
}

/**
 * Generate result - content with normalized usage.
 */
export interface GenerateResult {
  content: string;
  usage: NormalizedUsage;
}

/**
 * Image generation result.
 */
export interface ImageGenerationResult {
  imageData: Buffer;
  model: string;
  usage: NormalizedUsage;
}

export interface ImageGenerateOptions {
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  slug?: string;
}

export interface SynthesisInput {
  model: string;
  content: string;
}

export type LLMErrorCode =
  | 'API_ERROR'
  | 'TIMEOUT'
  | 'INVALID_KEY'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'CONTEXT_LENGTH'
  | 'CONTENT_FILTERED';

export interface LLMError {
  code: LLMErrorCode;
  message: string;
}

/**
 * Usage logger interface for dependency injection.
 * Clients call this to log usage to database.
 */
export interface UsageLogger {
  log(params: UsageLogParams): Promise<void>;
}

export interface UsageLogParams {
  userId: string;
  provider: string;
  model: string;
  method: string;
  usage: NormalizedUsage;
  success: boolean;
  errorMessage?: string;
}

/**
 * LLM Client interface.
 * All providers implement this interface.
 */
export interface LLMClient {
  research(prompt: string): Promise<Result<ResearchResult, LLMError>>;
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
  generateImage?(
    prompt: string,
    options?: ImageGenerateOptions
  ): Promise<Result<ImageGenerationResult, LLMError>>;
}
