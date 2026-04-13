/**
 * Factory functions for creating LLM adapters from API keys.
 * Usage logging is handled by the underlying clients (packages/infra-*).
 */

import type { Logger } from '@intexuraos/common-core';
import {
  getProviderForModel,
  type ModelPricing,
  type ResearchModel,
  type FastModel,
} from '@intexuraos/llm-contract';
import type { UsageSink } from '@intexuraos/llm-pricing';
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
  pricing: ModelPricing,
  logger: Logger,
  usageSink: UsageSink,
  researchId: string | undefined // @allow-undefined-type -- positional arg kept for call-site compat
): LlmResearchProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
    case 'anthropic':
      return new ClaudeAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
    case 'openai':
      return new GptAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
    case 'perplexity':
      return new PerplexityAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
    case 'openrouter':
      return new OpenRouterAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
  }
}

export function createSynthesizer(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  pricing: ModelPricing,
  logger: Logger,
  usageSink: UsageSink,
  researchId: string | undefined // @allow-undefined-type -- positional arg kept for call-site compat
): LlmSynthesisProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':
      return new GeminiAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
    case 'anthropic':
      throw new Error('Anthropic does not support synthesis');
    case 'openai':
      return new GptAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
    case 'perplexity':
      throw new Error('Perplexity does not support synthesis');
    case 'openrouter':
      return new OpenRouterAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
  }
}

export function createTitleGenerator(
  model: FastModel,
  apiKey: string,
  userId: string,
  pricing: ModelPricing,
  logger: Logger,
  usageSink: UsageSink,
  researchId: string | undefined // @allow-undefined-type -- positional arg kept for call-site compat
): TitleGenerator {
  return new GeminiAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
}

export function createContextInferrer(
  model: FastModel,
  apiKey: string,
  userId: string,
  pricing: ModelPricing,
  logger: Logger,
  usageSink: UsageSink,
  researchId: string | undefined // @allow-undefined-type -- positional arg kept for call-site compat
): ContextInferenceProvider {
  return new ContextInferenceAdapter(apiKey, model, userId, pricing, logger, usageSink, researchId);
}

export function createInputValidator(
  model: FastModel,
  apiKey: string,
  userId: string,
  pricing: ModelPricing,
  logger: Logger,
  usageSink: UsageSink
): InputValidationProvider {
  return new InputValidationAdapter(apiKey, model, userId, pricing, logger, usageSink);
}

export type { InputValidationProvider };
