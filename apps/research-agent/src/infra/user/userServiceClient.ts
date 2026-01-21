/**
 * HTTP client for user-service internal API.
 * Provides access to user API keys and WhatsApp phone numbers.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import {
  getProviderForModel,
  isValidModel,
  LlmModels,
  LlmProviders,
  type LlmProvider,
} from '@intexuraos/llm-contract';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import {
  createLlmClient,
  type LlmClientConfig,
  type LlmGenerateClient,
} from '@intexuraos/llm-factory';

export type { LlmProvider };

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
  getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>>;
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
  reportLlmSuccess(userId: string, provider: LlmProvider): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function providerToKeyField(provider: LlmProvider) {
  switch (provider) {
    case LlmProviders.Google:
      return 'google';
    case LlmProviders.OpenAI:
      return 'openai';
    case LlmProviders.Anthropic:
      return 'anthropic';
    case LlmProviders.Perplexity:
      return 'perplexity';
    case LlmProviders.Zai:
      return 'zai';
  }
}

/**
 * Create a user service client with the given configuration.
 */
export function createUserServiceClient(config: UserServiceConfig): UserServiceClient {
  const { logger } = config;

  return {
    async getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/users/${userId}/llm-keys`, {
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });

        if (!response.ok) {
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(response.status)}`,
          });
        }

        const data = (await response.json()) as {
          google?: string | null;
          openai?: string | null;
          anthropic?: string | null;
          perplexity?: string | null;
          zai?: string | null;
        };

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
        if (data.zai !== null && data.zai !== undefined) {
          result.zai = data.zai;
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

    async getLlmClient(
      userId: string
    ): Promise<Result<LlmGenerateClient, UserServiceError>> {
      logger.info({ userId }, 'Creating LLM client for user');

      try {
        // Step 1: Fetch user settings to get default model
        const settingsResponse = await fetch(
          `${config.baseUrl}/internal/users/${userId}/settings`,
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

        const settingsData = (await settingsResponse.json()) as {
          llmPreferences?: {
            defaultModel: string;
          };
        };

        // Step 2: Determine model (use user's preference or default)
        const rawModel = settingsData.llmPreferences?.defaultModel ?? LlmModels.Gemini25Flash;

        // Validate that the model is supported
        if (!isValidModel(rawModel)) {
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
          `${config.baseUrl}/internal/users/${userId}/llm-keys`,
          {
            headers: {
              'X-Internal-Auth': config.internalAuthToken,
            },
          }
        );

        if (!keysResponse.ok) {
          logger.error(
            { userId, status: keysResponse.status },
            'Failed to fetch API keys'
          );
          return err({
            code: 'API_ERROR',
            message: `Failed to fetch API keys: HTTP ${String(keysResponse.status)}`,
          });
        }

        const keysData = (await keysResponse.json()) as Record<
          string,
          string | null | undefined
        >;

        const apiKey = keysData[keyField];

        if (apiKey === null || apiKey === undefined) {
          logger.info({ userId, provider }, 'No API key configured for provider');
          return err({
            code: 'NO_API_KEY',
            message: `No API key configured for ${provider}. Please add your ${provider} API key in settings.`,
          });
        }

        // Step 4: Get pricing for the model
        const pricing = config.pricingContext.getPricing(defaultModel);

        // Step 5: Create and return the LLM client
        const clientConfig: LlmClientConfig = {
          apiKey,
          model: defaultModel,
          userId,
          pricing,
          logger: config.logger,
        };

        const client: LlmGenerateClient = createLlmClient(clientConfig);

        logger.info({ userId, model: defaultModel, provider }, 'LLM client created successfully');

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
        await fetch(`${config.baseUrl}/internal/users/${userId}/llm-keys/${provider}/last-used`, {
          method: 'POST',
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });
      } catch {
        /* Best effort - don't block on failure */
      }
    },
  };
}
