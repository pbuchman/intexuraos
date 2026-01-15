import type { Result, Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import {
  createLlmClient,
  type LlmClientConfig,
  type LlmGenerateClient,
} from '@intexuraos/llm-factory';
import {
  getProviderForModel,
  isValidModel,
  LlmModels,
  LlmProviders,
  type LlmProvider,
} from '@intexuraos/llm-contract';
import type { IPricingContext } from '@intexuraos/llm-pricing';

export interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
  logger: Logger;
}

export interface UserApiKeys {
  google?: string;
}

export interface UserServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'NO_API_KEY' | 'UNSUPPORTED_MODEL' | 'INVALID_MODEL';
  message: string;
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

export interface UserServiceClient {
  getApiKeys(userId: string): Promise<Result<UserApiKeys, UserServiceError>>;
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
}

export function createUserServiceClient(config: UserServiceConfig): UserServiceClient {
  return {
    async getApiKeys(userId: string): Promise<Result<UserApiKeys, UserServiceError>> {
      const url = `${config.baseUrl}/internal/users/${userId}/llm-keys`;

      config.logger.info({ userId }, 'Fetching user API keys');

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });
      } catch (error) {
        config.logger.error(
          {
            userId,
            error: getErrorMessage(error),
          },
          'Failed to fetch API keys'
        );
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }

      if (!response.ok) {
        let errorDetails = '';
        try {
          const body = await response.text();
          errorDetails = body.length > 0 ? `: ${body.substring(0, 200)}` : '';
        } catch {
          /* Body read errors are not worth logging separately */
        }

        config.logger.error(
          {
            userId,
            status: response.status,
            statusText: response.statusText,
          },
          'User service returned error'
        );

        return err({
          code: 'API_ERROR',
          message: `HTTP ${String(response.status)}${errorDetails}`,
        });
      }

      const data = (await response.json()) as {
        google?: string | null;
      };

      const result: UserApiKeys = {};
      if (data.google !== null && data.google !== undefined) {
        result.google = data.google;
      }

      config.logger.info(
        {
          userId,
          hasGoogleKey: result.google !== undefined,
        },
        'API keys fetched'
      );

      return ok(result);
    },

    async getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>> {
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
        };

        const client = createLlmClient(clientConfig);

        return ok(client);
      } catch (error) {
        const message = getErrorMessage(error);
        return err({
          code: 'NETWORK_ERROR',
          message,
        });
      }
    },
  };
}
