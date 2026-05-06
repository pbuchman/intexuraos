import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { type LLMModel } from '@intexuraos/llm-contract';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import type { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import type { FixedModelChatAdapter, FishingChatClientError } from '../../domain/ports/chatModel.js';

export const FISHING_ASSISTANT_CHAT_MODEL_ID = 'or:google/gemini-3-flash-preview';

const FISHING_ASSISTANT_CHAT_MODEL = FISHING_ASSISTANT_CHAT_MODEL_ID as LLMModel;

export interface FixedGeminiFlashClientDeps {
  userServiceClient: UserServiceClient;
  logger: Logger;
  usageSink: HttpInternalAuthUsageSink;
}

export function createFixedGeminiFlashClient(
  deps: FixedGeminiFlashClientDeps
): FixedModelChatAdapter {
  return {
    modelId: FISHING_ASSISTANT_CHAT_MODEL_ID,
    async createClientForUser(
      userId: string
    ): Promise<Result<LlmGenerateClient, FishingChatClientError>> {
      const keysResult = await deps.userServiceClient.getApiKeys(userId);
      if (!keysResult.ok) {
        return err({
          code: 'USER_KEYS_UNAVAILABLE',
          message: keysResult.error.message,
        });
      }

      const openRouterApiKey = keysResult.value.openrouter;
      if (openRouterApiKey === undefined || openRouterApiKey === '') {
        return err({
          code: 'NO_API_KEY',
          message: 'OpenRouter API key is required for Fishing Assistant chat.',
        });
      }

      return ok(
        createLlmClient({
          apiKey: openRouterApiKey,
          model: FISHING_ASSISTANT_CHAT_MODEL,
          userId,
          logger: deps.logger,
          usageSink: deps.usageSink,
          ownerType: 'user',
        })
      );
    },
  };
}
