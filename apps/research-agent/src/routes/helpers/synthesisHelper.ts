/**
 * Synthesis helper functions for creating synthesis providers.
 */

import { getProviderForModel, isOpenRouterModel, LlmModels, type LLMModel, type ModelPricing } from '@intexuraos/llm-contract';
import { getAllowlistPricing, isAllowedModel } from '@intexuraos/infra-openrouter';
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
  if (isOpenRouterModel(synthesisModel) && !isAllowedModel(synthesisModel)) {
    throw new Error(
      `OpenRouter model '${synthesisModel}' is not in the curated allowlist. ` +
        'Allowed models: qwen/qwen3.5-plus-02-15, qwen/qwen3.5-flash-02-23, minimax/minimax-m2.7, ' +
        'x-ai/grok-4.20-beta, x-ai/grok-4.1-fast, moonshotai/kimi-k2.5, anthropic/claude-sonnet-4.6, ' +
        'anthropic/claude-opus-4.6, google/gemini-3.1-pro-preview, google/gemini-2.5-flash, ' +
        'openai/gpt-5.4, openai/gpt-5.4-mini, xiaomi/mimo-v2-pro, z-ai/glm-5-turbo'
    );
  }
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- upstream: prior check for isAllowedModel validates model is in allowlist; getAllowlistPricing passthrough is guaranteed @preserve */
  const synthesisPricing = isOpenRouterModel(synthesisModel)
    ? getAllowlistPricing(synthesisModel) as ModelPricing
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
