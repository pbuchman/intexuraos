/**
 * LLM Provider ports for research and synthesis.
 * Implemented by Gemini, Claude, and GPT adapters.
 */

import type { Result } from '@intexuraos/common-core';
import type { ResearchContext, SynthesisContext } from '@intexuraos/llm-prompts';

export interface LlmError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED';
  message: string;
  usage?: LlmUsage;
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

/**
 * Per-call options forwarded by the adapter into the underlying infra
 * client's correlation bag. Currently only carries the originating
 * researchId so the emitted usage event can be attributed end-to-end.
 */
export interface ResearchProviderCallOptions {
  researchId?: string;
}

export interface LlmResearchProvider {
  research(
    prompt: string,
    ctx?: ResearchContext,
    options?: ResearchProviderCallOptions
  ): Promise<Result<LlmResearchResult, LlmError>>;
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
