import { createOpenRouterClient } from '@intexuraos/infra-openrouter';
import { getOpenRouterRawId, isOpenRouterModel, type ModelPricing } from '@intexuraos/llm-contract';
import type { LlmClientConfig, LlmGenerateClient, GenerateResult } from './llmClientFactory.js';
import type { LLMError } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';

/**
 * Create an OpenRouter generate client.
 * Requires pricing to be resolved (provided by {@link createLlmClient} which defaults to zero pricing).
 */
export function createOpenRouterGenerateClient(
  config: LlmClientConfig & { pricing: ModelPricing }
): LlmGenerateClient {
  const rawModel = isOpenRouterModel(config.model as string)
    ? getOpenRouterRawId(config.model as string)
    : (config.model as string);

  const orClient = createOpenRouterClient({
    apiKey: config.apiKey,
    model: rawModel,
    userId: config.userId,
    pricing: config.pricing,
    logger: config.logger,
    usageSink: config.usageSink,
    ...(config.ownerType !== undefined && { ownerType: config.ownerType }),
  });

  return {
    async generate(prompt: string): Promise<Result<GenerateResult, LLMError>> {
      return await orClient.generate(prompt);
    },
  };
}
