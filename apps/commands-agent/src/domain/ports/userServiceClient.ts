import type { Result } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

export interface UserApiKeys {
  google?: string;
}

export interface UserServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'NO_API_KEY' | 'UNSUPPORTED_MODEL' | 'INVALID_MODEL';
  message: string;
}

export interface UserServiceClient {
  getApiKeys(userId: string): Promise<Result<UserApiKeys, UserServiceError>>;
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
}
