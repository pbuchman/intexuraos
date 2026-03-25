/**
 * Synthesis helper functions for creating synthesis providers.
 */

import { getProviderForModel, isOpenRouterModel, getOpenRouterRawId, LlmModels, type LLMModel, type ModelPricing } from '@intexuraos/llm-contract';
import { getAllowlistPricing, isAllowedModel, allowlistModelIds } from '@intexuraos/infra-openrouter';
import type { ResearchModel } from '../../domain/research/index.js';
import type { ServiceContainer, DecryptedApiKeys } from '../../services.js';
import type { Logger } from '@intexuraos/common-core';
import type { LlmSynthesisProvider } from '../../domain/research/ports/index.js';
import type { ContextInferenceProvider } from '../../domain/research/ports/contextInference.js';

export interface SynthesisProviders {
  synthesizer: LlmSynthesisProvider;
  contextInferrer?: ContextInferenceProvider;
}

export function createSynthesisProviders(
  synthesisModel: ResearchModel,
  apiKeys: DecryptedApiKeys,
  userId: string,
  services: ServiceContainer,
  logger: Logger
): SynthesisProviders {
  const { createSynthesizer, createContextInferrer, pricingContext } = services;

  const synthesisProvider = getProviderForModel(synthesisModel);
  const synthesisKey = apiKeys[synthesisProvider];

  // Reject non-allowlisted OpenRouter models to enforce curated model policy
  if (isOpenRouterModel(synthesisModel) && !isAllowedModel(getOpenRouterRawId(synthesisModel))) {
    throw new Error(
      `OpenRouter model '${synthesisModel}' is not in the curated allowlist. ` +
        `Allowed models: ${allowlistModelIds()}`
    );
  }

  let synthesisPricing: ModelPricing;
  if (isOpenRouterModel(synthesisModel)) {
    const pricing = getAllowlistPricing(getOpenRouterRawId(synthesisModel));
    if (pricing === undefined) {
      throw new Error(`No pricing for allowlisted model: ${String(synthesisModel)}`);
    }
    synthesisPricing = pricing;
  } else {
    synthesisPricing = pricingContext.getPricing(synthesisModel as LLMModel);
  }

  if (synthesisKey === undefined || synthesisKey === '') {
    throw new Error(`No API key configured for provider '${synthesisProvider}'`);
  }

  const synthesizer = createSynthesizer(
    synthesisModel,
    synthesisKey,
    userId,
    synthesisPricing,
    logger
  );

  const result: SynthesisProviders = { synthesizer };

  if (apiKeys.google !== undefined) {
    result.contextInferrer = createContextInferrer(
      LlmModels.Gemini25Flash,
      apiKeys.google,
      userId,
      pricingContext.getPricing(LlmModels.Gemini25Flash),
      logger
    );
  }

  return result;
}
