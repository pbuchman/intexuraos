import type { Logger, Result } from '@intexuraos/common-core';
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
 * OAuth token result from user-service.
 */
export interface OAuthTokenResult {
  accessToken: string;
  email: string;
}

/**
 * Supported OAuth providers.
 */
export type OAuthProvider = 'google';

/**
 * Error from user service operations.
 */
export interface UserServiceError {
  code:
    | 'NETWORK_ERROR'
    | 'API_ERROR'
    | 'NO_API_KEY'
    | 'INVALID_MODEL'
    | 'CONNECTION_NOT_FOUND'
    | 'TOKEN_REFRESH_FAILED'
    | 'OAUTH_NOT_CONFIGURED';
  message: string;
}

/**
 * Client interface for user-service internal API.
 */
export interface UserServiceClient {
  getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>>;
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
  reportLlmSuccess(userId: string, provider: LlmProvider): Promise<void>;
  getOAuthToken(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<OAuthTokenResult, UserServiceError>>;
}
