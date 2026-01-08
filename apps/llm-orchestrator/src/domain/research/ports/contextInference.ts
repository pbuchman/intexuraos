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
} from '@intexuraos/llm-common';
import type { LlmError } from './llmProvider.js';

export interface ContextInferenceProvider {
  inferResearchContext(
    userQuery: string,
    opts?: InferResearchContextOptions
  ): Promise<Result<ResearchContext, LlmError>>;

  inferSynthesisContext(
    params: InferSynthesisContextParams
  ): Promise<Result<SynthesisContext, LlmError>>;
}
