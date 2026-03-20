import type { Result } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

/**
 * Domain-specific error type for user service operations.
 * Defined in domain layer to avoid importing from infrastructure packages.
 */
export interface UserServiceError {
  code: string;
  message: string;
}

export interface UserServicePort {
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
}
