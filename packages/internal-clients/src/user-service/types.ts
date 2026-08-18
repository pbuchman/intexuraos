import type { Logger, Result } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { ExecutableLlmProvider, IntexAgentModel } from '@intexuraos/llm-contract';

/**
 * Configuration for the user service client.
 */
export interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
  /**
   * Usage sink used when materializing per-user LLM clients via
   * {@link UserServiceClient.getLlmClient}. Required — production apps
   * should pass an HttpInternalAuthUsageSink tagged with their own
   * `service` / `component`. Tests may pass a FakeUsageSink.
   */
  usageSink: UsageSink;
  platformOpenRouterApiKey?: string | undefined;
}

/**
 * Decrypted API keys returned from user-service.
 */
export interface DecryptedApiKeys {
  /** @deprecated Retained only for rolling-deploy and historical test compatibility. */
  openai?: string;
  /** @deprecated Retained only for rolling-deploy and historical test compatibility. */
  anthropic?: string;
  /** @deprecated Retained only for rolling-deploy and historical test compatibility. */
  perplexity?: string;
  openrouter?: string;
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
export type OAuthProvider = 'google' | 'github';

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

export type IntexAgentRuntimeSettingsV1 =
  | {
      status: 'available';
      effectiveModel: IntexAgentModel;
      explicitModel: IntexAgentModel | null;
      source: 'explicit' | 'default_absent';
      revision: number;
      timeZone: string;
    }
  | {
      status: 'unavailable';
      effectiveModel: 'or:deepseek/deepseek-v4-flash';
      source: 'platform_default';
      timeZone: string;
    };

export interface IntexAgentRuntimeSettingsClientError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'TIMEOUT' | 'MALFORMED_RESPONSE';
  message: string;
}

export interface IntexAgentRuntimeSettingsClient {
  resolveIntexAgentRuntimeSettings(
    userId: string
  ): Promise<Result<IntexAgentRuntimeSettingsV1, IntexAgentRuntimeSettingsClientError>>;
}

export interface UserTimezoneLookupOptions {
  signal?: AbortSignal;
  throwOnError?: boolean;
}

/**
 * Client interface for user-service internal API.
 */
export interface UserServiceClient {
  getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>>;
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
  reportLlmSuccess(userId: string, provider: ExecutableLlmProvider): Promise<void>;
  getOAuthToken(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<OAuthTokenResult, UserServiceError>>;
  resolveGitHubUsername(
    gitHubUsername: string
  ): Promise<Result<{ userId: string } | null, UserServiceError>>;
  getUserTimezone(userId: string, options?: UserTimezoneLookupOptions): Promise<string | undefined>;
}
