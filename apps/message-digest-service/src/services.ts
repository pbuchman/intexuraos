import { Firestore } from '@google-cloud/firestore';
import { PubSub, type PublishOptions } from '@google-cloud/pubsub';
import type { Logger } from '@intexuraos/common-core';
import { createAppLogger } from '@intexuraos/infra-sentry';
import {
  createWhatsAppServiceClient,
  type WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import {
  createLlmClient,
  type LlmClientConfig,
  type LlmGenerateClient,
} from '@intexuraos/llm-factory';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import type { Config } from './config.js';
import type {
  MessageDigestAggregator,
  MessageDigestWhatsAppClient,
} from './domain/ports/messageDigestClients.js';
import type { MessageDigestStore } from './domain/ports/messageDigestStore.js';
import type { FrozenMessageDigestPayloadPublisher } from './domain/ports/messageDigestPublishers.js';
import type { MessageDigestRunPreparationTokens } from './domain/ports/runPreparationTokens.js';
import { createFirestoreMessageDigestStore } from './infra/firestore/firestoreMessageDigestStore.js';
import { createMessageDigestCursorCodec } from './infra/firestore/messageDigestDocuments.js';
import { createWhatsAppDigestClient } from './infra/http/whatsappDigestClient.js';
import {
  createMessageDigestAggregator,
  type MessageDigestAggregatorConfig,
} from './infra/llm/messageDigestAggregator.js';
import {
  createFrozenPayloadPublisher,
  type FrozenPayloadTopic,
} from './infra/pubsub/frozenPayloadPublisher.js';
import { createRunPreparationTokenCodec } from './infra/security/runPreparationToken.js';

interface WhatsAppClientFactoryInput {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

interface UsageSinkFactoryInput {
  usageServiceUrl: string;
  internalAuthToken: string;
  service: string;
  component: string;
  logger: Logger;
}

interface MessageDigestStoreFactoryInput {
  firestore: Firestore;
  cursorSecret: string;
}

interface MessageDigestPubSubFactoryInput {
  projectId: string;
  apiEndpoint?: string | undefined;
}

export interface MessageDigestPubSub {
  topic(name: string, options?: PublishOptions): FrozenPayloadTopic;
}

const BOUNDED_PUBLISH_OPTIONS: PublishOptions = {
  batching: { maxMessages: 1, maxMilliseconds: 1 },
  gaxOpts: { timeout: 30_000, retry: null },
};

export interface ServiceFactories {
  createLogger(): Logger;
  createFirestore(projectId: string): Firestore;
  createWhatsAppServiceClient(input: WhatsAppClientFactoryInput): WhatsAppServiceClient;
  createMessageDigestStore(input: MessageDigestStoreFactoryInput): MessageDigestStore;
  createMessageDigestWhatsAppClient(client: WhatsAppServiceClient): MessageDigestWhatsAppClient;
  createUsageSink(input: UsageSinkFactoryInput): HttpInternalAuthUsageSink;
  createLlmClient(input: LlmClientConfig): LlmGenerateClient;
  createMessageDigestAggregator(input: MessageDigestAggregatorConfig): MessageDigestAggregator;
  createPubSub(input: MessageDigestPubSubFactoryInput): MessageDigestPubSub;
  createFrozenPayloadPublisher(topic: FrozenPayloadTopic): FrozenMessageDigestPayloadPublisher;
  createRunPreparationTokens(secret: string): MessageDigestRunPreparationTokens;
}

export interface ServiceContainer {
  config: Config;
  logger: Logger;
  firestore: Firestore;
  whatsappServiceClient: WhatsAppServiceClient;
  messageDigestStore: MessageDigestStore;
  messageDigestWhatsAppClient: MessageDigestWhatsAppClient;
  usageSink: HttpInternalAuthUsageSink;
  messageDigestAggregator: MessageDigestAggregator;
  pubsub: MessageDigestPubSub;
  messageDigestRunPublisher: FrozenMessageDigestPayloadPublisher;
  whatsappSendPublisher: FrozenMessageDigestPayloadPublisher;
  runPreparationTokens: MessageDigestRunPreparationTokens;
}

const defaultFactories: ServiceFactories = {
  createLogger: (): Logger =>
    createAppLogger({
      name: 'message-digest-service',
      level: (process.env['LOG_LEVEL'] ?? 'info') as 'error' | 'info' | 'warn' | 'debug' | 'silent',
    }),
  createFirestore: (projectId): Firestore => new Firestore({ projectId }),
  createWhatsAppServiceClient,
  createMessageDigestStore: ({ firestore, cursorSecret }): MessageDigestStore =>
    createFirestoreMessageDigestStore({
      firestore,
      cursorCodec: createMessageDigestCursorCodec({ secret: cursorSecret }),
    }),
  createMessageDigestWhatsAppClient: createWhatsAppDigestClient,
  createUsageSink: (input): HttpInternalAuthUsageSink => new HttpInternalAuthUsageSink(input),
  createLlmClient,
  createMessageDigestAggregator,
  createPubSub: ({ projectId, apiEndpoint }): MessageDigestPubSub =>
    new PubSub({ projectId, ...(apiEndpoint === undefined ? {} : { apiEndpoint }) }),
  createFrozenPayloadPublisher,
  createRunPreparationTokens: (secret): MessageDigestRunPreparationTokens =>
    createRunPreparationTokenCodec({
      currentKey: { version: 'v1', secret },
    }),
};

let container: ServiceContainer | null = null;

export function createServiceContainer(
  config: Config,
  factories: ServiceFactories = defaultFactories
): ServiceContainer {
  const logger = factories.createLogger();
  const firestore = factories.createFirestore(config.firestoreProjectId);
  const whatsappServiceClient = factories.createWhatsAppServiceClient({
    baseUrl: config.whatsappServiceUrl,
    internalAuthToken: config.internalAuthToken,
    logger,
  });
  const usageSink = factories.createUsageSink({
    usageServiceUrl: config.llmUsageServiceUrl,
    internalAuthToken: config.internalAuthToken,
    service: 'message-digest-service',
    component: 'message-digest',
    logger,
  });
  const messageDigestAggregator = factories.createMessageDigestAggregator({
    createLlmClient: (userId) =>
      factories.createLlmClient({
        apiKey: config.openRouterAppApiKey,
        model: config.digestLlmModel as LlmClientConfig['model'],
        userId,
        logger,
        usageSink,
        ownerType: 'user',
      }),
    model: config.digestLlmModel,
  });
  const pubsub = factories.createPubSub({
    projectId: config.pubsubProjectId,
    ...(config.pubsubEmulatorHost === undefined
      ? {}
      : { apiEndpoint: config.pubsubEmulatorHost }),
  });
  const messageDigestRunPublisher = factories.createFrozenPayloadPublisher(
    pubsub.topic(config.messageDigestRunTopic, BOUNDED_PUBLISH_OPTIONS)
  );
  const whatsappSendPublisher = factories.createFrozenPayloadPublisher(
    pubsub.topic(config.whatsappSendTopic, BOUNDED_PUBLISH_OPTIONS)
  );
  const runPreparationTokens = factories.createRunPreparationTokens(config.internalAuthToken);
  return {
    config,
    logger,
    firestore,
    whatsappServiceClient,
    messageDigestStore: factories.createMessageDigestStore({
      firestore,
      cursorSecret: config.internalAuthToken,
    }),
    messageDigestWhatsAppClient: factories.createMessageDigestWhatsAppClient(whatsappServiceClient),
    usageSink,
    messageDigestAggregator,
    pubsub,
    messageDigestRunPublisher,
    whatsappSendPublisher,
    runPreparationTokens,
  };
}

export function initServices(config: Config, factories: ServiceFactories = defaultFactories): void {
  container = createServiceContainer(config, factories);
}

export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Message Digest service container is not initialized');
  }
  return container;
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = null;
}
