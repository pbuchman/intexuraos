/**
 * HTTP client for user-service internal API.
 * Provides access to user API keys and LLM client creation.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import {
  getProviderForModel,
  isDefaultEligibleModel,
  LlmModels,
  LlmProviders,
  type LlmProvider,
  type LLMModel,
} from '@intexuraos/llm-contract';
import {
  createLlmClient,
  type LlmClientConfig,
  type LlmGenerateClient,
  type GenerateOptions,
} from '@intexuraos/llm-factory';

import type {
  UserServiceConfig,
  UserServiceError,
  DecryptedApiKeys,
  UserServiceClient,
  OAuthTokenResult,
  OAuthProvider,
  UserTimezoneLookupOptions,
} from './types.js';

export type { LlmProvider } from '@intexuraos/llm-contract';
export type {
  UserServiceConfig,
  UserServiceError,
  DecryptedApiKeys,
  UserServiceClient,
  OAuthTokenResult,
  OAuthProvider,
  UserTimezoneLookupOptions,
} from './types.js';

const PROVIDER_KEYS: Record<LlmProvider, string> = {
  google: 'google',
  openai: 'openai',
  anthropic: 'anthropic',
  perplexity: 'perplexity',
  openrouter: 'openrouter',
};

export function providerToKeyField(provider: LlmProvider): string {
  return PROVIDER_KEYS[provider];
}

/**
 * Create a user service client with the given configuration.
 */
export function createUserServiceClient(config: UserServiceConfig): UserServiceClient {
  const { logger } = config;

  return {
    async getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>> {
      try {
        const response = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/llm-keys`,
          {
            headers: {
              'X-Internal-Auth': config.internalAuthToken,
            },
          }
        );

        if (!response.ok) {
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(response.status)}`,
          });
        }

        const body = (await response.json()) as {
          success: boolean;
          data: {
            google?: string | null;
            openai?: string | null;
            anthropic?: string | null;
            perplexity?: string | null;
            openrouter?: string | null;
          };
        };

        const data = body.data;

        // Convert null values to undefined (null is used by JSON to distinguish from missing)
        const result: DecryptedApiKeys = {};
        if (data.google !== null && data.google !== undefined) {
          result.google = data.google;
        }
        if (data.openai !== null && data.openai !== undefined) {
          result.openai = data.openai;
        }
        if (data.anthropic !== null && data.anthropic !== undefined) {
          result.anthropic = data.anthropic;
        }
        if (data.perplexity !== null && data.perplexity !== undefined) {
          result.perplexity = data.perplexity;
        }
        if (data.openrouter !== null && data.openrouter !== undefined) {
          result.openrouter = data.openrouter;
        }

        return ok(result);
      } catch (error) {
        const message = getErrorMessage(error);
        return err({
          code: 'NETWORK_ERROR',
          message,
        });
      }
    },

    async getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>> {
      logger.info({ userId }, 'Creating LLM client for user');

      try {
        // Step 1: Fetch user settings to get default model
        const settingsResponse = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/settings`,
          {
            headers: {
              'X-Internal-Auth': config.internalAuthToken,
            },
          }
        );

        if (!settingsResponse.ok) {
          logger.error(
            { userId, status: settingsResponse.status },
            'Failed to fetch user settings'
          );
          return err({
            code: 'API_ERROR',
            message: `Failed to fetch user settings: HTTP ${String(settingsResponse.status)}`,
          });
        }

        const settingsBody = (await settingsResponse.json()) as {
          success: boolean;
          data: {
            llmPreferences?: {
              defaultModel: string;
              fallbackModel?: string;
            };
          };
        };

        // Step 2: Determine model (use user's preference or default)
        const rawModel = settingsBody.data.llmPreferences?.defaultModel ?? LlmModels.Gemini25Flash;
        const fallbackModelRaw = settingsBody.data.llmPreferences?.fallbackModel;

        // Validate that the model is supported (including OpenRouter models)
        if (!isDefaultEligibleModel(rawModel)) {
          logger.warn({ userId, invalidModel: rawModel }, 'User has invalid model preference');
          return err({
            code: 'INVALID_MODEL',
            message: `Invalid model: ${rawModel}. Please select a valid model.`,
          });
        }

        const defaultModel = rawModel;

        // Step 3: Get API key for that model
        const provider = getProviderForModel(defaultModel);
        const keyField = providerToKeyField(provider);

        const keysResponse = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/llm-keys`,
          {
            headers: {
              'X-Internal-Auth': config.internalAuthToken,
            },
          }
        );

        if (!keysResponse.ok) {
          logger.error({ userId, status: keysResponse.status }, 'Failed to fetch API keys');
          return err({
            code: 'API_ERROR',
            message: `Failed to fetch API keys: HTTP ${String(keysResponse.status)}`,
          });
        }

        const keysBody = (await keysResponse.json()) as {
          success: boolean;
          data: Record<string, string | null | undefined>;
        };

        const apiKey = keysBody.data[keyField];

        if (apiKey === null || apiKey === undefined) {
          if (config.platformGeminiApiKey !== undefined) {
            logger.warn(
              { userId, provider, requestedModel: defaultModel },
              'No API key for provider, falling back to platform Gemini25Flash'
            );
            const fallbackModel = LlmModels.Gemini25Flash;
            const fallbackClient = createLlmClient({
              apiKey: config.platformGeminiApiKey,
              model: fallbackModel,
              userId,
              logger: config.logger,
              usageSink: config.usageSink,
              ownerType: 'user',
            });

            logger.info(
              { userId, model: fallbackModel, provider: LlmProviders.Google },
              'LLM client created successfully'
            );

            return ok(fallbackClient);
          }

          logger.info({ userId, provider }, 'No API key configured for provider');
          return err({
            code: 'NO_API_KEY',
            message: `No API key configured for ${provider}. Please add your ${provider} API key in settings.`,
          });
        }

        // Helper: build a client for a given model using the fetched API keys
        function buildClientForModel(
          model: string,
          apiKeys: Record<string, string | null | undefined>
        ): LlmGenerateClient | null {
          const modelProvider = getProviderForModel(model);
          const modelKeyField = providerToKeyField(modelProvider);
          const modelApiKey = apiKeys[modelKeyField];
          if (modelApiKey === null || modelApiKey === undefined) return null;

          return createLlmClient({
            apiKey: modelApiKey,
            model: model as LLMModel,
            userId,
            logger: config.logger,
            usageSink: config.usageSink,
            ownerType: 'user',
          });
        }

        // Step 4: Create and return the LLM client
        const clientConfig: LlmClientConfig = {
          apiKey,
          model: defaultModel as LLMModel,
          userId,
          logger: config.logger,
          usageSink: config.usageSink,
          ownerType: 'user',
        };

        const client: LlmGenerateClient = createLlmClient(clientConfig);

        logger.info({ userId, model: defaultModel, provider }, 'LLM client created successfully');

        // Step 6: Wrap with fallback retry if fallback model is configured
        if (fallbackModelRaw !== undefined && isDefaultEligibleModel(fallbackModelRaw)) {
          const primaryClient = client;
          const wrappedClient: LlmGenerateClient = {
            async generate(prompt: string, options: GenerateOptions) {
              const primaryResult = await primaryClient.generate(prompt, options);
              if (primaryResult.ok) return primaryResult;

              logger.warn(
                {
                  userId,
                  primaryModel: defaultModel,
                  fallbackModel: fallbackModelRaw,
                  error: primaryResult.error,
                  _skipSentry: true,
                },
                'Primary model failed, attempting fallback'
              );

              const fallbackClient = buildClientForModel(fallbackModelRaw, keysBody.data);
              if (fallbackClient === null) {
                logger.warn(
                  { userId, fallbackModel: fallbackModelRaw },
                  'No API key for fallback model'
                );
                return primaryResult;
              }

              const fallbackResult = await fallbackClient.generate(prompt, options);
              if (fallbackResult.ok) {
                logger.info(
                  { userId, primaryModel: defaultModel, fallbackModel: fallbackModelRaw },
                  'Fallback model succeeded after primary failure'
                );
              }
              return fallbackResult;
            },
          };
          return ok(wrappedClient);
        }

        return ok(client);
      } catch (error) {
        logger.error(
          { userId, error: getErrorMessage(error) },
          'Network error while creating LLM client'
        );
        const message = getErrorMessage(error);
        return err({
          code: 'NETWORK_ERROR',
          message,
        });
      }
    },

    async reportLlmSuccess(userId: string, provider: LlmProvider): Promise<void> {
      try {
        await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/llm-keys/${provider}/last-used`,
          {
            method: 'POST',
            headers: {
              'X-Internal-Auth': config.internalAuthToken,
            },
          }
        );
      } catch {
        // Best effort - don't block on failure
      }
    },

    async resolveGitHubUsername(
      gitHubUsername: string
    ): Promise<Result<{ userId: string } | null, UserServiceError>> {
      try {
        const response = await fetch(
          `${config.baseUrl}/internal/users/by-github-username/${encodeURIComponent(gitHubUsername)}`,
          { headers: { 'X-Internal-Auth': config.internalAuthToken } }
        );
        if (response.status === 404) return ok(null);
        if (!response.ok) {
          return err({ code: 'API_ERROR', message: `HTTP ${String(response.status)}` });
        }
        const body = (await response.json()) as { success: boolean; data: { userId: string } };
        return ok({ userId: body.data.userId });
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },

    async getUserTimezone(
      userId: string,
      options?: UserTimezoneLookupOptions
    ): Promise<string | undefined> {
      try {
        const response = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/settings`,
          {
            headers: { 'X-Internal-Auth': config.internalAuthToken },
            ...(options?.signal !== undefined ? { signal: options.signal } : {}),
          }
        );

        if (!response.ok) {
          if (options?.throwOnError === true) {
            throw new Error(`HTTP ${String(response.status)}`);
          }
          logger.warn({ userId, status: response.status }, 'Failed to fetch user timezone');
          return undefined;
        }

        const body = (await response.json()) as {
          success: boolean;
          data: {
            timezone?: string;
          };
        };

        return body.data.timezone;
      } catch (error) {
        if (options?.throwOnError === true) {
          throw error;
        }
        logger.warn({ userId, error: getErrorMessage(error) }, 'Failed to fetch user timezone');
        return undefined;
      }
    },

    async getOAuthToken(
      userId: string,
      provider: OAuthProvider
    ): Promise<Result<OAuthTokenResult, UserServiceError>> {
      try {
        const response = await fetch(
          `${config.baseUrl}/internal/users/${encodeURIComponent(userId)}/oauth/${provider}/token`,
          {
            headers: { 'X-Internal-Auth': config.internalAuthToken },
          }
        );

        if (!response.ok) {
          const errorBody = (await response.json()) as { code?: string; error?: string };
          const code = errorBody.code;

          if (code === 'CONNECTION_NOT_FOUND' || response.status === 404) {
            return err({ code: 'CONNECTION_NOT_FOUND', message: 'OAuth not connected' });
          }
          if (code === 'TOKEN_REFRESH_FAILED') {
            return err({ code: 'TOKEN_REFRESH_FAILED', message: 'Failed to refresh token' });
          }
          if (code === 'CONFIGURATION_ERROR') {
            return err({ code: 'OAUTH_NOT_CONFIGURED', message: 'OAuth not configured' });
          }

          return err({
            code: 'API_ERROR',
            message: errorBody.error ?? `HTTP ${String(response.status)}`,
          });
        }

        const body = (await response.json()) as {
          success: boolean;
          data: { accessToken: string; email: string };
        };
        return ok({ accessToken: body.data.accessToken, email: body.data.email });
      } catch (error) {
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },
  };
}
