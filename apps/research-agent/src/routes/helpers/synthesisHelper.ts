/**
 * Synthesis helper functions for creating synthesis providers.
 */

import { getProviderForModel, isOpenRouterModel, getOpenRouterRawId, LlmModels } from '@intexuraos/llm-contract';
import { isAllowedModel } from '@intexuraos/infra-openrouter';
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
  researchId: string | undefined,
  services: ServiceContainer,
  logger: Logger
): SynthesisProviders {
  const { createSynthesizer, createContextInferrer } = services;

  const synthesisProvider = getProviderForModel(synthesisModel);
  const synthesisKey = apiKeys[synthesisProvider];

  // Reject non-allowlisted OpenRouter models to enforce curated model policy
  if (isOpenRouterModel(synthesisModel) && !isAllowedModel(getOpenRouterRawId(synthesisModel))) {
    throw new Error(
      `OpenRouter model '${synthesisModel}' is not in the curated allowlist`
    );
  }

  if (synthesisKey === undefined || synthesisKey === '') {
    throw new Error(`No API key configured for provider '${synthesisProvider}'`);
  }

  const synthesizer = createSynthesizer(
    synthesisModel,
    synthesisKey,
    userId,
    logger,
    researchId
  );

  const result: SynthesisProviders = { synthesizer };

  if (apiKeys.google !== undefined) {
    result.contextInferrer = createContextInferrer(
      LlmModels.Gemini25Flash,
      apiKeys.google,
      userId,
      logger,
      researchId
    );
  }

  return result;
}
