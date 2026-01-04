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
import { GeminiAdapter } from './GeminiAdapter.js';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import { GptAdapter } from './GptAdapter.js';
import { ContextInferenceAdapter } from './ContextInferenceAdapter.js';

export function createResearchProvider(model: SupportedModel, apiKey: string): LlmResearchProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model);
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model);
    case 'openai':
      return new GptAdapter(apiKey, model);
  }
}

export function createSynthesizer(model: SupportedModel, apiKey: string): LlmSynthesisProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model);
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model);
    case 'openai':
      return new GptAdapter(apiKey, model);
  }
}

export function createTitleGenerator(model: string, apiKey: string): TitleGenerator {
  return new GeminiAdapter(apiKey, model);
}

export function createContextInferrer(
  model: string,
  apiKey: string,
  logger?: Logger
): ContextInferenceProvider {
  return new ContextInferenceAdapter(apiKey, model, logger);
}
