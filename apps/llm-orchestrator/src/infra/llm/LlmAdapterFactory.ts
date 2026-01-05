/**
 * Factory functions for creating LLM adapters from API keys.
 * Usage logging is handled by the underlying clients (packages/infra-*).
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
import { PerplexityAdapter } from './PerplexityAdapter.js';
import { ContextInferenceAdapter } from './ContextInferenceAdapter.js';

export function createResearchProvider(
  model: SupportedModel,
  apiKey: string,
  userId: string
): LlmResearchProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model, userId);
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model, userId);
    case 'openai':
      return new GptAdapter(apiKey, model, userId);
    case 'perplexity':
      return new PerplexityAdapter(apiKey, model, userId);
  }
}

export function createSynthesizer(
  model: SupportedModel,
  apiKey: string,
  userId: string
): LlmSynthesisProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model, userId);
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model, userId);
    case 'openai':
      return new GptAdapter(apiKey, model, userId);
    case 'perplexity':
      throw new Error('Perplexity does not support synthesis');
  }
}

export function createTitleGenerator(
  model: string,
  apiKey: string,
  userId: string
): TitleGenerator {
  return new GeminiAdapter(apiKey, model, userId);
}

export function createContextInferrer(
  model: string,
  apiKey: string,
  userId: string,
  logger?: Logger
): ContextInferenceProvider {
  return new ContextInferenceAdapter(apiKey, model, userId, logger);
}
