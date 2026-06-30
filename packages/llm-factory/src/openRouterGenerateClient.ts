import { createOpenRouterClient } from '@intexuraos/infra-openrouter';
import { getOpenRouterRawId, isOpenRouterModel } from '@intexuraos/llm-contract';
import type {
  GenerateChatOptions,
  GenerateChatResult,
  LlmChatMessage,
  LlmClientConfig,
  LlmGenerateClient,
  GenerateResult,
  GenerateOptions,
} from './llmClientFactory.js';
import type { LLMError } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';

export function createOpenRouterGenerateClient(config: LlmClientConfig): LlmGenerateClient {
  const rawModel = isOpenRouterModel(config.model as string)
    ? getOpenRouterRawId(config.model as string)
    : (config.model as string);

  const orClient = createOpenRouterClient({
    apiKey: config.apiKey,
    model: rawModel,
    userId: config.userId,
    logger: config.logger,
    usageSink: config.usageSink,
    ...(config.ownerType !== undefined && { ownerType: config.ownerType }),
  });

  return {
    async generate(
      prompt: string,
      options: GenerateOptions
    ): Promise<Result<GenerateResult, LLMError>> {
      return await orClient.generate(prompt, options);
    },
    async generateChat(
      messages: LlmChatMessage[],
      options: GenerateChatOptions
    ): Promise<Result<GenerateChatResult, LLMError>> {
      return await orClient.generateChat(messages, options);
    },
  };
}
