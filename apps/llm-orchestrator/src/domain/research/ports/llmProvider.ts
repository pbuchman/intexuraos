/**
 * LLM Provider ports for research and synthesis.
 * Implemented by Gemini, Claude, and GPT adapters.
 */

import type { Result } from '@intexuraos/common-core';
import type { SynthesisContext } from '@intexuraos/llm-common';

export interface LlmError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED';
  message: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface TitleGenerateResult {
  title: string;
  usage: LlmUsage;
}

export interface LabelGenerateResult {
  label: string;
  usage: LlmUsage;
}

export interface LlmResearchResult {
  content: string;
  sources?: string[];
  usage?: LlmUsage;
}

export interface LlmSynthesisResult {
  content: string;
  usage?: LlmUsage;
}

export interface LlmResearchProvider {
  research(prompt: string): Promise<Result<LlmResearchResult, LlmError>>;
}

export interface LlmSynthesisProvider {
  synthesize(
    originalPrompt: string,
    reports: { model: string; content: string }[],
    additionalSources?: { content: string; label?: string }[],
    synthesisContext?: SynthesisContext
  ): Promise<Result<LlmSynthesisResult, LlmError>>;

  generateTitle(prompt: string): Promise<Result<TitleGenerateResult, LlmError>>;
}

export interface TitleGenerator {
  generateTitle(prompt: string): Promise<Result<TitleGenerateResult, LlmError>>;
  generateContextLabel(content: string): Promise<Result<LabelGenerateResult, LlmError>>;
}
