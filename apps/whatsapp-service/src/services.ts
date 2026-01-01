/**
 * Service wiring for whatsapp-service.
 * Provides class-based adapters for domain use cases.
 */
import {
  MessageRepositoryAdapter,
  UserMappingRepositoryAdapter,
  WebhookEventRepositoryAdapter,
} from './adapters.js';
import { GcsMediaStorageAdapter } from './infra/gcs/index.js';
import { GcpPubSubPublisher } from './infra/pubsub/index.js';
import { WhatsAppCloudApiAdapter, WhatsAppCloudApiSender } from './infra/whatsapp/index.js';
import { SpeechmaticsTranscriptionAdapter } from './infra/speechmatics/index.js';
import { ThumbnailGeneratorAdapter } from './infra/media/index.js';
import { OpenGraphFetcher } from './infra/linkpreview/openGraphFetcher.js';
import type {
  EventPublisherPort,
  LinkPreviewFetcherPort,
  MediaStoragePort,
  SpeechTranscriptionPort,
  ThumbnailGeneratorPort,
  WhatsAppCloudApiPort,
  WhatsAppMessageRepository,
  WhatsAppMessageSender,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEventRepository,
} from './domain/inbox/index.js';

/**
 * Configuration for service initialization.
 */
export interface ServiceConfig {
  mediaBucket: string;
  gcpProjectId: string;
  mediaCleanupTopic: string;
  commandsIngestTopic?: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  speechmaticsApiKey: string;
}

/**
 * Service container holding all adapter instances.
 * Uses domain interface types for proper type inference.
 */
export interface ServiceContainer {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  userMappingRepository: WhatsAppUserMappingRepository;
  messageRepository: WhatsAppMessageRepository;
  mediaStorage: MediaStoragePort;
  eventPublisher: EventPublisherPort;
  messageSender: WhatsAppMessageSender;
  transcriptionService: SpeechTranscriptionPort;
  whatsappCloudApi: WhatsAppCloudApiPort;
  thumbnailGenerator: ThumbnailGeneratorPort;
  linkPreviewFetcher: LinkPreviewFetcherPort;
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
    mediaStorage: new GcsMediaStorageAdapter(serviceConfig.mediaBucket),
    eventPublisher: new GcpPubSubPublisher(
      serviceConfig.gcpProjectId,
      serviceConfig.mediaCleanupTopic,
      serviceConfig.commandsIngestTopic
    ),
    messageSender: new WhatsAppCloudApiSender(
      serviceConfig.whatsappAccessToken,
      serviceConfig.whatsappPhoneNumberId
    ),
    transcriptionService: new SpeechmaticsTranscriptionAdapter(serviceConfig.speechmaticsApiKey),
    whatsappCloudApi: new WhatsAppCloudApiAdapter(serviceConfig.whatsappAccessToken),
    thumbnailGenerator: new ThumbnailGeneratorAdapter(),
    linkPreviewFetcher: new OpenGraphFetcher(),
  };
  return container;
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
