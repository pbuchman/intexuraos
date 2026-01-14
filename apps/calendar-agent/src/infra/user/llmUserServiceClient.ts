import type { Result } from '@intexuraos/common-core';
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
import pino from 'pino';
import type { Logger } from 'pino';

const defaultLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'llmUserServiceClient',
});

export interface LlmUserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
  logger?: Logger;
}

export interface LlmUserServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'NO_API_KEY' | 'INVALID_MODEL';
  message: string;
}

export interface LlmUserServiceClient {
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, LlmUserServiceError>>;
}

function providerToKeyField(provider: LlmProvider): string {
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

export function createLlmUserServiceClient(config: LlmUserServiceConfig): LlmUserServiceClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async getLlmClient(
      userId: string
    ): Promise<Result<LlmGenerateClient, LlmUserServiceError>> {
      logger.info({ userId }, 'Creating LLM client for user');

      try {
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

        const rawModel = settingsData.llmPreferences?.defaultModel ?? LlmModels.Gemini25Flash;

        if (!isValidModel(rawModel)) {
          logger.warn({ userId, invalidModel: rawModel }, 'User has invalid model preference');
          return err({
            code: 'INVALID_MODEL',
            message: `Invalid model: ${rawModel}. Please select a valid model.`,
          });
        }

        const defaultModel = rawModel;

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

        const pricing = config.pricingContext.getPricing(defaultModel);

        const clientConfig: LlmClientConfig = {
          apiKey,
          model: defaultModel,
          userId,
          pricing,
        };

        const client = createLlmClient(clientConfig);

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
  };
}
