/**
 * LLM Contract Types.
 *
 * Common types and interfaces for LLM client implementations.
 */

import type { Result } from '@intexuraos/common-core';

export interface LLMConfig {
  apiKey: string;
  defaultModel: string;
  validationModel: string;
  researchModel: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ResearchResult {
  content: string;
  sources: string[];
  usage?: TokenUsage;
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
  | 'CONTEXT_LENGTH';

export interface LLMError {
  code: LLMErrorCode;
  message: string;
}

export interface LLMClient {
  research(prompt: string): Promise<Result<ResearchResult, LLMError>>;
  validateKey(): Promise<Result<boolean, LLMError>>;
  generate(prompt: string): Promise<Result<string, LLMError>>;
  synthesize(
    originalPrompt: string,
    reports: SynthesisInput[],
    externalReports?: { content: string; model?: string }[]
  ): Promise<Result<string, LLMError>>;
}
