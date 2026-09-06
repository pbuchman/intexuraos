/**
 * Synthesis helper functions for creating synthesis providers.
 */

import {
  DEFAULT_PLATFORM_LLM_MODEL,
} from '@intexuraos/llm-contract';
import type { ResearchModel } from '../../domain/research/index.js';
import type { ServiceContainer, DecryptedApiKeys } from '../../services.js';
import type { Logger } from '@intexuraos/common-core';
import type { LlmSynthesisProvider } from '../../domain/research/ports/index.js';
import type { ContextInferenceProvider } from '../../domain/research/ports/contextInference.js';
import { isExecutableSynthesisModel } from './storedResearchModels.js';

export interface SynthesisProviders {
  synthesizer: LlmSynthesisProvider;
  contextInferrer?: ContextInferenceProvider;
}

export function createSynthesisProviders(
  synthesisModel: ResearchModel,
  apiKeys: DecryptedApiKeys,
  userId: string,
  services: ServiceContainer,
  logger: Logger,
  /**
   * The research being synthesised. Forwarded to both the synthesizer and
   * context-inferrer factories so every internal `client.generate()` call
   * carries `correlation.researchId` and llm-usage-service can attribute
   * the synthesis/title/context cost to this research. Optional so
   * lightweight callers (tests) can omit it; in production
   * `handleAllCompleted` always provides it.
   */
  researchId?: string
): SynthesisProviders {
  const { createSynthesizer, createContextInferrer } = services;

  if (!isExecutableSynthesisModel(synthesisModel)) {
    throw new Error(`Research synthesis model '${synthesisModel}' is not executable`);
  }

  const synthesisKey = apiKeys.openrouter;
  if (synthesisKey === undefined || synthesisKey === '') {
    throw new Error("No API key configured for provider 'openrouter'");
  }

  const synthesizer = createSynthesizer(synthesisModel, synthesisKey, userId, logger, researchId);

  const result: SynthesisProviders = { synthesizer };

  result.contextInferrer = createContextInferrer(
    DEFAULT_PLATFORM_LLM_MODEL,
    synthesisKey,
    userId,
    logger,
    researchId
  );

  return result;
}
