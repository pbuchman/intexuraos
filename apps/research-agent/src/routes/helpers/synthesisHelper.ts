/**
 * Synthesis helper functions for creating synthesis providers.
 */

import { getProviderForModel, LlmModels } from '@intexuraos/llm-contract';
import type { ResearchModel } from '../../domain/research/index.js';
import type { ServiceContainer, DecryptedApiKeys } from '../../services.js';
import type { Logger } from '@intexuraos/common-core';
import type { LlmSynthesisProvider } from '../../domain/research/ports/index.js';
import type { ContextInferenceProvider } from '../../domain/research/ports/contextInference.js';
import pino from 'pino';

/**
 * No-op logger for when no logger is provided.
 * Uses pino with 'silent' level which doesn't output anything.
 */
const silentLogger: Logger = pino({ level: 'silent' });

export interface SynthesisProviders {
  synthesizer: LlmSynthesisProvider;
  contextInferrer?: ContextInferenceProvider;
}

export function createSynthesisProviders(
  synthesisModel: ResearchModel,
  apiKeys: DecryptedApiKeys,
  userId: string,
  services: ServiceContainer,
  logger?: Logger
): SynthesisProviders {
  const { createSynthesizer, createContextInferrer, pricingContext } = services;

  const synthesisProvider = getProviderForModel(synthesisModel);
  const synthesisKey = apiKeys[synthesisProvider];

  const actualLogger = logger ?? silentLogger;

  const synthesizer = createSynthesizer(
    synthesisModel,
    synthesisKey as string,
    userId,
    pricingContext.getPricing(synthesisModel),
    actualLogger
  );

  const result: SynthesisProviders = { synthesizer };

  if (apiKeys.google !== undefined) {
    result.contextInferrer = createContextInferrer(
      LlmModels.Gemini25Flash,
      apiKeys.google,
      userId,
      pricingContext.getPricing(LlmModels.Gemini25Flash),
      actualLogger
    );
  }

  return result;
}
