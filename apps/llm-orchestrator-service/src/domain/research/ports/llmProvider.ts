/**
 * LLM Provider ports for research and synthesis.
 * Implemented by Gemini, Claude, and GPT adapters.
 */

import type { Result } from '@intexuraos/common-core';

export interface LlmError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED';
  message: string;
}

export interface LlmResearchResult {
  content: string;
  sources?: string[];
}

export interface LlmResearchProvider {
  research(prompt: string): Promise<Result<LlmResearchResult, LlmError>>;
}

export interface LlmSynthesisProvider {
  synthesize(
    originalPrompt: string,
    reports: { model: string; content: string }[],
    inputContexts?: { content: string }[]
  ): Promise<Result<string, LlmError>>;

  generateTitle(prompt: string): Promise<Result<string, LlmError>>;
}
