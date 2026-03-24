/**
 * Synthesis helper functions for creating synthesis providers.
 */

import { getProviderForModel, isOpenRouterModel, LlmModels, type LLMModel } from '@intexuraos/llm-contract';
import { getAllowlistPricing } from '@intexuraos/infra-openrouter';
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

  // For OpenRouter models, use allowlist pricing instead of pricingContext
  // getAllowlistPricing returns undefined only for non-allowlisted models
  /* v8 ignore start -- ts-type: cannot statically verify OpenRouter model is in pricing allowlist @preserve */
  const synthesisPricing = isOpenRouterModel(synthesisModel)
    ? getAllowlistPricing(synthesisModel) ?? { inputPricePerMillion: 0, outputPricePerMillion: 0, useProviderCost: true }
    : pricingContext.getPricing(synthesisModel as LLMModel);
  /* v8 ignore stop @preserve */

  const synthesizer = createSynthesizer(
    synthesisModel,
    synthesisKey as string,
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
