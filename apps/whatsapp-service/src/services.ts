/**
 * Service wiring for whatsapp-service.
 * Provides class-based adapters for domain use cases.
 */
import { createAppLogger } from '@intexuraos/infra-sentry';
import {
  MessageRepositoryAdapter,
  NotificationPreferencesRepositoryAdapter,
  PhoneVerificationRepositoryAdapter,
  UserMappingRepositoryAdapter,
  WebhookEventRepositoryAdapter,
} from './adapters.js';
import { GcsMediaStorageAdapter } from './infra/gcs/index.js';
import { GcpPubSubPublisher, type GcpPubSubPublisherConfig } from './infra/pubsub/index.js';
import { WhatsAppCloudApiAdapter, WhatsAppCloudApiSender } from './infra/whatsapp/index.js';
import { ThumbnailGeneratorAdapter } from './infra/media/index.js';
import { createWebAgentLinkPreviewClient } from './infra/linkpreview/webAgentLinkPreviewClient.js';
import { createLlmClient } from '@intexuraos/llm-factory';
import { createUserServiceClient } from '@intexuraos/internal-clients';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { err, ok } from '@intexuraos/common-core';
import type {
  EventPublisherPort,
  LinkPreviewFetcherPort,
  MediaStoragePort,
  NotificationPreferencesRepository,
  OutboundMessageRepository,
  PhoneVerificationRepository,
  PrivateWhatsAppRepository,
  ThumbnailGeneratorPort,
  WhatsAppCloudApiPort,
  WhatsAppMessageRepository,
  WhatsAppMessageSender,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEventRepository,
} from './domain/whatsapp/index.js';
import type {
  ConversationAssistantLlmClientFactory,
  ConversationAssistantRepository,
} from './domain/conversation-assistant/ports.js';
import { createOutboundMessageRepository } from './infra/firestore/outboundMessageRepository.js';
import { createPrivateWhatsAppRepository } from './infra/firestore/privateWhatsAppRepository.js';
import { createConversationAssistantRepository } from './infra/firestore/conversationAssistantRepository.js';

/**
 * Configuration for service initialization.
 */
export interface ServiceConfig {
  mediaBucket: string;
  gcpProjectId: string;
  mediaCleanupTopic: string;
  audioStoredTopic: string;
  intexMessageIngestTopic: string;
  webhookProcessTopic?: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  webAgentUrl: string;
  internalAuthToken: string;
  llmUsageServiceUrl: string;
  userServiceUrl: string;
  conversationAssistantModel: string;
}

function buildPubSubConfig(config: ServiceConfig): GcpPubSubPublisherConfig {
  const pubsubConfig: GcpPubSubPublisherConfig = {
    projectId: config.gcpProjectId,
    mediaCleanupTopic: config.mediaCleanupTopic,
    audioStoredTopic: config.audioStoredTopic,
    intexMessageIngestTopic: config.intexMessageIngestTopic,
    logger: createAppLogger({ name: 'whatsapp-pubsub-publisher' }),
  };
  if (config.webhookProcessTopic !== undefined) {
    pubsubConfig.webhookProcessTopic = config.webhookProcessTopic;
  }
  return pubsubConfig;
}

/**
 * Service container holding all adapter instances.
 * Uses domain interface types for proper type inference.
 */
export interface ServiceContainer {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  userMappingRepository: WhatsAppUserMappingRepository;
  messageRepository: WhatsAppMessageRepository;
  outboundMessageRepository: OutboundMessageRepository;
  phoneVerificationRepository: PhoneVerificationRepository;
  notificationPreferencesRepository: NotificationPreferencesRepository;
  privateWhatsAppRepository: PrivateWhatsAppRepository;
  mediaStorage: MediaStoragePort;
  eventPublisher: EventPublisherPort;
  messageSender: WhatsAppMessageSender;
  whatsappCloudApi: WhatsAppCloudApiPort;
  thumbnailGenerator: ThumbnailGeneratorPort;
  linkPreviewFetcher: LinkPreviewFetcherPort;
  conversationAssistantRepository?: ConversationAssistantRepository;
  llmClientFactory?: ConversationAssistantLlmClientFactory;
  conversationAssistantModel?: string;
}

let container: ServiceContainer | null = null;
let serviceConfig: ServiceConfig | null = null;

/**
 * Initialize the service container with configuration.
 * Must be called before getServices().
 */
export function initServices(config: ServiceConfig): void {
  serviceConfig = config;
}

/**
 * Get the service container.
 * Throws if initServices() was not called first.
 */
export function getServices(): ServiceContainer {
  if (container !== null) {
    return container;
  }

  if (serviceConfig === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }

  container = {
    webhookEventRepository: new WebhookEventRepositoryAdapter(),
    userMappingRepository: new UserMappingRepositoryAdapter(),
    messageRepository: new MessageRepositoryAdapter(),
    outboundMessageRepository: createOutboundMessageRepository(),
    phoneVerificationRepository: new PhoneVerificationRepositoryAdapter(),
    notificationPreferencesRepository: new NotificationPreferencesRepositoryAdapter(),
    privateWhatsAppRepository: createPrivateWhatsAppRepository(),
    mediaStorage: new GcsMediaStorageAdapter(serviceConfig.mediaBucket),
    eventPublisher: new GcpPubSubPublisher(buildPubSubConfig(serviceConfig)),
    messageSender: new WhatsAppCloudApiSender(
      serviceConfig.whatsappAccessToken,
      serviceConfig.whatsappPhoneNumberId
    ),
    whatsappCloudApi: new WhatsAppCloudApiAdapter(serviceConfig.whatsappAccessToken),
    thumbnailGenerator: new ThumbnailGeneratorAdapter(),
    linkPreviewFetcher: createWebAgentLinkPreviewClient({
      baseUrl: serviceConfig.webAgentUrl,
      internalAuthToken: serviceConfig.internalAuthToken,
      logger: createAppLogger({ name: 'webAgentLinkPreviewClient' }),
    }),
    conversationAssistantRepository: createConversationAssistantRepository(),
    llmClientFactory: createConversationAssistantLlmClientFactory(serviceConfig),
    conversationAssistantModel: serviceConfig.conversationAssistantModel,
  };
  return container;
}

export function createConversationAssistantLlmClientFactory(
  config: ServiceConfig
): ConversationAssistantLlmClientFactory {
  const usageSink = new HttpInternalAuthUsageSink({
    usageServiceUrl: config.llmUsageServiceUrl,
    internalAuthToken: config.internalAuthToken,
    service: 'whatsapp-service',
    component: 'conversation-assistant',
    logger: createAppLogger({ name: 'whatsapp-conversation-assistant-usage-sink' }),
  });
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'whatsapp-conversation-assistant-user-service' }),
    usageSink,
  });
  return {
    async createLlmClientForUser(
      userId: string
    ): ReturnType<ConversationAssistantLlmClientFactory['createLlmClientForUser']> {
      const keysResult = await userServiceClient.getApiKeys(userId);
      if (!keysResult.ok) {
        return err({ code: 'LLM_ERROR', message: keysResult.error.message });
      }
      const openRouterKey = keysResult.value.openrouter;
      if (openRouterKey === undefined) {
        return err({
          code: 'LLM_ERROR',
          message: 'No OpenRouter API key configured. Please add your OpenRouter API key in settings.',
        });
      }
      return ok(createLlmClient({
        apiKey: openRouterKey,
        model: config.conversationAssistantModel as never,
        userId,
        logger: createAppLogger({ name: 'whatsapp-conversation-assistant-llm' }),
        usageSink,
        ownerType: 'user',
      }));
    },
  };
}

/**
 * Set a custom service container (for testing).
 */
export function setServices(services: ServiceContainer): void {
  container = services;
}

/**
 * Reset the service container (for testing).
 */
export function resetServices(): void {
  container = null;
}
