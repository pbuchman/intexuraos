/**
 * Context inference port for two-phase prompt building.
 * Uses fast LLM (Gemini Flash) to infer context from user queries.
 */

import type { Result } from '@intexuraos/common-core';
import type {
  InferResearchContextOptions,
  InferSynthesisContextParams,
  ResearchContext,
  SynthesisContext,
} from '@intexuraos/llm-prompts';
import type { LlmError, LlmUsage } from './llmProvider.js';

export interface ResearchContextResult {
  context: ResearchContext;
  usage: LlmUsage;
}

export interface SynthesisContextResult {
  context: SynthesisContext;
  usage: LlmUsage;
}

export interface ContextInferenceProvider {
  inferResearchContext(
    userQuery: string,
    opts?: InferResearchContextOptions
  ): Promise<Result<ResearchContextResult, LlmError>>;

  inferSynthesisContext(
    params: InferSynthesisContextParams
  ): Promise<Result<SynthesisContextResult, LlmError>>;
}
