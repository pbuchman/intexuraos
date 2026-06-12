import type { Logger } from '@intexuraos/common-core';
import { getFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { createAppLogger } from '@intexuraos/infra-sentry';
import {
  createMobileNotificationsServiceClient,
  createUserServiceClient,
  type MobileNotificationsServiceClient,
  type UserServiceClient,
} from '@intexuraos/internal-clients';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import OpenAI from 'openai';
import type { Config } from './config.js';
import type { FishingChatRepository } from './domain/ports/chatRepository.js';
import type { FixedModelChatAdapter } from './domain/ports/chatModel.js';
import type { KnowledgeEmbeddingClient } from './domain/ports/embeddingClient.js';
import type {
  KnowledgeChunkRepository,
  KnowledgeFolderRepository,
  KnowledgePageRepository,
} from './domain/ports/knowledgeRepositories.js';
import { createFirestoreChatRepository } from './infra/firestore/chatRepository.js';
import { createFirestoreChunkRepository } from './infra/firestore/chunkRepository.js';
import { createFirestoreFolderRepository } from './infra/firestore/folderRepository.js';
import { createFirestorePageRepository } from './infra/firestore/pageRepository.js';
import { createOpenAiKnowledgeEmbeddingClient } from './infra/llm/embeddingClient.js';
import { createFixedGeminiFlashClient } from './infra/llm/fixedGeminiFlashClient.js';

export interface FirestoreRepositories {
  firestore: Firestore;
  folderRepository: KnowledgeFolderRepository;
  pageRepository: KnowledgePageRepository;
  chunkRepository: KnowledgeChunkRepository;
}

export interface ServiceContainer {
  generateId: () => string;
  logger: Logger;
  repositories: FirestoreRepositories;
  chatRepository: FishingChatRepository;
  embeddingClient: KnowledgeEmbeddingClient;
  openAiClient: OpenAI;
  userServiceClient: UserServiceClient;
  mobileNotificationsClient: MobileNotificationsServiceClient;
  usageSink: HttpInternalAuthUsageSink;
  chatAdapter: FixedModelChatAdapter;
}

let container: ServiceContainer | null = null;

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

  const firestore = getFirestore();
  const openAiClient = new OpenAI({ apiKey: config.openAiAppApiKey });

  container = {
    generateId: (): string => crypto.randomUUID(),
    logger,
    repositories: {
      firestore,
      folderRepository: createFirestoreFolderRepository({ firestore, logger }),
      pageRepository: createFirestorePageRepository({ firestore, logger }),
      chunkRepository: createFirestoreChunkRepository({ firestore, logger }),
    },
    chatRepository: createFirestoreChatRepository({ firestore, logger }),
    embeddingClient: createOpenAiKnowledgeEmbeddingClient({ openAiClient, logger }),
    openAiClient,
    userServiceClient,
    mobileNotificationsClient: createMobileNotificationsServiceClient({
      baseUrl: config.mobileNotificationsServiceUrl,
      internalAuthToken: config.internalAuthToken,
      logger,
    }),
    usageSink,
    chatAdapter: createFixedGeminiFlashClient({
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
