/**
 * Factory functions for creating LLM adapters from API keys.
 * Usage logging is handled by the underlying clients (packages/infra-*).
 */

import type { Logger } from '@intexuraos/common-core';
import { getProviderForModel, type ModelPricing, type ResearchModel, type FastModel } from '@intexuraos/llm-contract';
import type {
  LlmResearchProvider,
  LlmSynthesisProvider,
  TitleGenerator,
} from '../../domain/research/index.js';
import type { ContextInferenceProvider } from '../../domain/research/ports/contextInference.js';
import { GeminiAdapter } from './GeminiAdapter.js';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import { GptAdapter } from './GptAdapter.js';
import { PerplexityAdapter } from './PerplexityAdapter.js';
import { ContextInferenceAdapter } from './ContextInferenceAdapter.js';

export function createResearchProvider(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  pricing: ModelPricing
): LlmResearchProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model, userId, pricing);
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model, userId, pricing);
    case 'openai':
      return new GptAdapter(apiKey, model, userId, pricing);
    case 'perplexity':
      return new PerplexityAdapter(apiKey, model, userId, pricing);
  }
}

export function createSynthesizer(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  pricing: ModelPricing
): LlmSynthesisProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model, userId, pricing);
    case 'anthropic':
      throw new Error('Anthropic does not support synthesis');
    case 'openai':
      return new GptAdapter(apiKey, model, userId, pricing);
    case 'perplexity':
      throw new Error('Perplexity does not support synthesis');
  }
}

export function createTitleGenerator(
  model: FastModel,
  apiKey: string,
  userId: string,
  pricing: ModelPricing
): TitleGenerator {
  return new GeminiAdapter(apiKey, model, userId, pricing);
}

export function createContextInferrer(
  model: FastModel,
  apiKey: string,
  userId: string,
  pricing: ModelPricing,
  logger?: Logger
): ContextInferenceProvider {
  return new ContextInferenceAdapter(apiKey, model, userId, pricing, logger);
}
