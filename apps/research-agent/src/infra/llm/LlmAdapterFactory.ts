/**
 * Factory functions for creating LLM adapters from API keys.
 * Usage logging is handled by the underlying clients (packages/infra-*).
 */

import type { Logger } from '@intexuraos/common-core';
import {
  getProviderForModel,
  isLegacyGoogleModel,
  type LLMModel,
  type OpenRouterToolCallingModel,
  type ResearchModel,
} from '@intexuraos/llm-contract';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type {
  LlmResearchProvider,
  LlmSynthesisProvider,
  TitleGenerator,
} from '../../domain/research/index.js';
import type { ContextInferenceProvider } from '../../domain/research/ports/contextInference.js';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import { GptAdapter } from './GptAdapter.js';
import { PerplexityAdapter } from './PerplexityAdapter.js';
import { OpenRouterAdapter } from './OpenRouterAdapter.js';
import { ContextInferenceAdapter } from './ContextInferenceAdapter.js';
import {
  InputValidationAdapter,
  type InputValidationProvider,
} from './InputValidationAdapter.js';

export function createResearchProvider(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  logger: Logger,
  usageSink: UsageSink
): LlmResearchProvider {
  if (isLegacyGoogleModel(model as string)) {
    throw new Error('Direct Google LLM models are disabled; use an or:google/ OpenRouter model');
  }
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model, userId, logger, usageSink);
    case 'openai':
      return new GptAdapter(apiKey, model, userId, logger, usageSink);
    case 'perplexity':
      return new PerplexityAdapter(apiKey, model, userId, logger, usageSink);
    case 'openrouter':
      return new OpenRouterAdapter(apiKey, model, userId, logger, usageSink);
  }
}

export function createSynthesizer(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  logger: Logger,
  usageSink: UsageSink,
  researchId?: string
): LlmSynthesisProvider {
  if (isLegacyGoogleModel(model as string)) {
    throw new Error('Direct Google LLM models are disabled; use an or:google/ OpenRouter model');
  }
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'anthropic':
      throw new Error('Anthropic does not support synthesis');
    case 'openai':
      return new GptAdapter(apiKey, model, userId, logger, usageSink, researchId);
    case 'perplexity':
      throw new Error('Perplexity does not support synthesis');
    case 'openrouter':
      return new OpenRouterAdapter(apiKey, model, userId, logger, usageSink, researchId);
  }
}

export function createTitleGenerator(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  logger: Logger,
  usageSink: UsageSink,
  researchId?: string
): TitleGenerator {
  if (isLegacyGoogleModel(model as string)) {
    throw new Error('Direct Google LLM models are disabled; use an or:google/ OpenRouter model');
  }
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'openai':
      throw new Error('OpenAI does not support context-label title generation');
    case 'openrouter':
      return new OpenRouterAdapter(apiKey, model, userId, logger, usageSink, researchId);
    case 'anthropic':
    case 'perplexity':
      throw new Error(`${provider} does not support title generation`);
  }
}

export function createContextInferrer(
  model: LLMModel | OpenRouterToolCallingModel,
  apiKey: string,
  userId: string,
  logger: Logger,
  usageSink: UsageSink,
  researchId?: string
): ContextInferenceProvider {
  return new ContextInferenceAdapter(apiKey, model, userId, logger, usageSink, researchId);
}

export function createInputValidator(
  model: LLMModel | OpenRouterToolCallingModel,
  apiKey: string,
  userId: string,
  logger: Logger,
  usageSink: UsageSink,
  researchId?: string
): InputValidationProvider {
  return new InputValidationAdapter(apiKey, model, userId, logger, usageSink, researchId);
}

export type { InputValidationProvider };
