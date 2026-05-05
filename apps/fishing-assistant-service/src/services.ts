import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import { getFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { createAppLogger } from '@intexuraos/infra-sentry';
import {
  createMobileNotificationsServiceClient,
  createUserServiceClient,
  type MobileNotificationsServiceClient,
  type UserServiceClient,
} from '@intexuraos/internal-clients';
import { createOpenRouterModelId, type LLMModel } from '@intexuraos/llm-contract';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import OpenAI from 'openai';
import type { Config } from './config.js';

export const FISHING_ASSISTANT_CHAT_MODEL_ID = 'or:google/gemini-3-flash-preview';
const FISHING_ASSISTANT_CHAT_MODEL = createOpenRouterModelId(
  'google/gemini-3-flash-preview'
) as unknown as LLMModel;

export interface FirestoreRepositories {
  firestore: Firestore;
}

export interface FishingChatClientError {
  code: 'USER_KEYS_UNAVAILABLE' | 'NO_OPENROUTER_API_KEY';
  message: string;
}

export interface FixedModelChatAdapter {
  modelId: string;
  createClientForUser(
    userId: string
  ): Promise<Result<LlmGenerateClient, FishingChatClientError>>;
}

export interface ServiceContainer {
  generateId: () => string;
  logger: Logger;
  repositories: FirestoreRepositories;
  openAiClient: OpenAI;
  userServiceClient: UserServiceClient;
  mobileNotificationsClient: MobileNotificationsServiceClient;
  usageSink: HttpInternalAuthUsageSink;
  chatAdapter: FixedModelChatAdapter;
}

let container: ServiceContainer | null = null;

function createFixedModelChatAdapter(deps: {
  userServiceClient: UserServiceClient;
  logger: Logger;
  usageSink: HttpInternalAuthUsageSink;
}): FixedModelChatAdapter {
  return {
    modelId: FISHING_ASSISTANT_CHAT_MODEL_ID,
    async createClientForUser(
      userId: string
    ): Promise<Result<LlmGenerateClient, FishingChatClientError>> {
      const keysResult = await deps.userServiceClient.getApiKeys(userId);
      if (!keysResult.ok) {
        return err({
          code: 'USER_KEYS_UNAVAILABLE',
          message: keysResult.error.message,
        });
      }

      const openRouterApiKey = keysResult.value.openrouter;
      if (openRouterApiKey === undefined || openRouterApiKey === '') {
        return err({
          code: 'NO_OPENROUTER_API_KEY',
          message: 'No OpenRouter API key configured for Fishing Assistant chat.',
        });
      }

      return ok(
        createLlmClient({
          apiKey: openRouterApiKey,
          model: FISHING_ASSISTANT_CHAT_MODEL,
          userId,
          logger: deps.logger,
          usageSink: deps.usageSink,
          ownerType: 'user',
        })
      );
    },
  };
}

export function initServices(config: Config): void {
  const logger = createAppLogger({
    name: 'fishing-assistant-service',
    level: (process.env['LOG_LEVEL'] ?? 'info') as 'error' | 'info' | 'warn' | 'debug' | 'silent',
  });

  const usageSink = new HttpInternalAuthUsageSink({
    usageServiceUrl: config.llmUsageServiceUrl,
    internalAuthToken: config.internalAuthToken,
    service: 'fishing-assistant-service',
    component: 'rag-chat',
    logger,
  });

  const userServiceUsageSink = new HttpInternalAuthUsageSink({
    usageServiceUrl: config.llmUsageServiceUrl,
    internalAuthToken: config.internalAuthToken,
    service: 'fishing-assistant-service',
    component: 'user-service-client',
    logger,
  });

  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    logger,
    usageSink: userServiceUsageSink,
  });

  container = {
    generateId: (): string => crypto.randomUUID(),
    logger,
    repositories: {
      firestore: getFirestore(),
    },
    openAiClient: new OpenAI({ apiKey: config.openAiAppApiKey }),
    userServiceClient,
    mobileNotificationsClient: createMobileNotificationsServiceClient({
      baseUrl: config.mobileNotificationsServiceUrl,
      internalAuthToken: config.internalAuthToken,
      logger,
    }),
    usageSink,
    chatAdapter: createFixedModelChatAdapter({
      userServiceClient,
      logger,
      usageSink,
    }),
  };
}

export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = null;
}
