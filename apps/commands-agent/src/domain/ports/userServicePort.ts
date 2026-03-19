import type { Result } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

export interface UserServiceError {
  code: string;
  message: string;
}

export interface UserServicePort {
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
}
