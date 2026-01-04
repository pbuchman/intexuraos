/**
 * Factory functions for creating LLM adapters from API keys.
 */

import type { Logger } from '@intexuraos/common-core';
import { getProviderForModel, type SupportedModel } from '@intexuraos/llm-contract';
import type {
  LlmResearchProvider,
  LlmSynthesisProvider,
  TitleGenerator,
} from '../../domain/research/index.js';
import type { ContextInferenceProvider } from '../../domain/research/ports/contextInference.js';
import type { LlmUsageTracker } from '../../domain/research/services/index.js';
import { GeminiAdapter } from './GeminiAdapter.js';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import { GptAdapter } from './GptAdapter.js';
import { PerplexityAdapter } from './PerplexityAdapter.js';
import { ContextInferenceAdapter } from './ContextInferenceAdapter.js';

export function createResearchProvider(
  model: SupportedModel,
  apiKey: string,
  tracker?: LlmUsageTracker
): LlmResearchProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model, tracker);
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model, tracker);
    case 'openai':
      return new GptAdapter(apiKey, model, tracker);
    case 'perplexity':
      return new PerplexityAdapter(apiKey, model, tracker);
  }
}

export function createSynthesizer(
  model: SupportedModel,
  apiKey: string,
  tracker?: LlmUsageTracker
): LlmSynthesisProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model, tracker);
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model, tracker);
    case 'openai':
      return new GptAdapter(apiKey, model, tracker);
    case 'perplexity':
      throw new Error('Perplexity does not support synthesis');
  }
}

export function createTitleGenerator(
  model: string,
  apiKey: string,
  tracker?: LlmUsageTracker
): TitleGenerator {
  return new GeminiAdapter(apiKey, model, tracker);
}

export function createContextInferrer(
  model: string,
  apiKey: string,
  logger?: Logger,
  tracker?: LlmUsageTracker
): ContextInferenceProvider {
  return new ContextInferenceAdapter(apiKey, model, logger, tracker);
}
