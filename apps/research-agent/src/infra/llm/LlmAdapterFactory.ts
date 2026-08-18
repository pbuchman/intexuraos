/**
 * Factory functions for creating LLM adapters from API keys.
 * Usage logging is handled by the underlying clients (packages/infra-*).
 */

import type { Logger } from '@intexuraos/common-core';
import {
  getOpenRouterRawId,
  isOpenRouterModel,
  RESEARCH_SYNTHESIS_MODELS,
  type OpenRouterModelId,
  type ResearchModel,
} from '@intexuraos/llm-contract';
import { isAllowedModel } from '@intexuraos/infra-openrouter';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type {
  LlmResearchProvider,
  LlmSynthesisProvider,
  TitleGenerator,
} from '../../domain/research/index.js';
import type { ContextInferenceProvider } from '../../domain/research/ports/contextInference.js';
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
  if (!isAllowedOpenRouterModel(model)) {
    throw new Error('Only allowlisted OpenRouter research models are executable');
  }
  return new OpenRouterAdapter(apiKey, model, userId, logger, usageSink);
}

export function createSynthesizer(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  logger: Logger,
  usageSink: UsageSink,
  researchId?: string
): LlmSynthesisProvider {
  if (
    !isAllowedOpenRouterModel(model) ||
    !RESEARCH_SYNTHESIS_MODELS.some((synthesisModel) => synthesisModel === model)
  ) {
    throw new Error('Only allowlisted OpenRouter synthesis models are executable');
  }
  return new OpenRouterAdapter(apiKey, model, userId, logger, usageSink, researchId);
}

export function createTitleGenerator(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  logger: Logger,
  usageSink: UsageSink,
  researchId?: string
): TitleGenerator {
  if (!isAllowedOpenRouterModel(model)) {
    throw new Error('Only allowlisted OpenRouter title models are executable');
  }
  return new OpenRouterAdapter(apiKey, model, userId, logger, usageSink, researchId);
}

function isAllowedOpenRouterModel(model: string): model is OpenRouterModelId {
  return isOpenRouterModel(model) && isAllowedModel(getOpenRouterRawId(model));
}

export function createContextInferrer(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  logger: Logger,
  usageSink: UsageSink,
  researchId?: string
): ContextInferenceProvider {
  if (!isAllowedOpenRouterModel(model)) {
    throw new Error('Only allowlisted OpenRouter context models are executable');
  }
  return new ContextInferenceAdapter(apiKey, model, userId, logger, usageSink, researchId);
}

export function createInputValidator(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  logger: Logger,
  usageSink: UsageSink,
  researchId?: string
): InputValidationProvider {
  if (!isAllowedOpenRouterModel(model)) {
    throw new Error('Only allowlisted OpenRouter validation models are executable');
  }
  return new InputValidationAdapter(apiKey, model, userId, logger, usageSink, researchId);
}

export type { InputValidationProvider };
