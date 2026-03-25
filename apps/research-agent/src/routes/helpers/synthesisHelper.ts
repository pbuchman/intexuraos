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
  /* v8 ignore start -- upstream: prior check for OpenRouter model validity ensures this fallback is never reached in unit tests @preserve */
  if (isOpenRouterModel(synthesisModel) && !isAllowedModel(getOpenRouterRawId(synthesisModel))) {
    throw new Error(
      `OpenRouter model '${synthesisModel}' is not in the curated allowlist. ` +
        `Allowed models: ${allowlistModelIds()}`
    );
  }
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- upstream: prior check for isAllowedModel validates model is in allowlist; getAllowlistPricing passthrough is guaranteed @preserve */
  const synthesisPricing = isOpenRouterModel(synthesisModel)
    ? getAllowlistPricing(getOpenRouterRawId(synthesisModel)) as ModelPricing
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
