import type { Result } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

export interface FishingChatClientError {
  code: 'USER_KEYS_UNAVAILABLE' | 'NO_API_KEY';
  message: string;
}

export interface FixedModelChatAdapter {
  modelId: string;
  createClientForUser(
    userId: string
  ): Promise<Result<LlmGenerateClient, FishingChatClientError>>;
}
