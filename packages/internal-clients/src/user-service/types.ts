import type { Logger } from '@intexuraos/common-core';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { LlmProvider } from '@intexuraos/llm-contract';

/**
 * Configuration for the user service client.
 */
export interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
  logger: Logger;
}

/**
 * Decrypted API keys returned from user-service.
 */
export interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
  perplexity?: string;
  zai?: string;
}

/**
 * Error from user service operations.
 */
export interface UserServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'NO_API_KEY' | 'INVALID_MODEL';
  message: string;
}

/**
 * Client interface for user-service internal API.
 */
export interface UserServiceClient {
  getApiKeys(
    userId: string
  ): Promise<import('@intexuraos/common-core').Result<DecryptedApiKeys, UserServiceError>>;
  getLlmClient(
    userId: string
  ): Promise<import('@intexuraos/common-core').Result<LlmGenerateClient, UserServiceError>>;
  reportLlmSuccess(userId: string, provider: LlmProvider): Promise<void>;
}
