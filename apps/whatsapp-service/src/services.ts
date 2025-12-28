/**
 * Service wiring for whatsapp-service.
 * Provides class-based adapters for domain use cases.
 */
import {
  WebhookEventRepositoryAdapter,
  UserMappingRepositoryAdapter,
  MessageRepositoryAdapter,
} from './adapters.js';
import { GcsMediaStorageAdapter } from './infra/gcs/index.js';
import { GcpPubSubPublisher } from './infra/pubsub/index.js';
import { WhatsAppCloudApiSender, WhatsAppCloudApiAdapter } from './infra/whatsapp/index.js';
import { SpeechmaticsTranscriptionAdapter } from './infra/speechmatics/index.js';
import { ThumbnailGeneratorAdapter } from './infra/media/index.js';
import { OpenGraphFetcher } from './infra/linkpreview/openGraphFetcher.js';
import type {
  WhatsAppWebhookEventRepository,
  WhatsAppUserMappingRepository,
  WhatsAppMessageRepository,
  MediaStoragePort,
  EventPublisherPort,
  WhatsAppMessageSender,
  SpeechTranscriptionPort,
  WhatsAppCloudApiPort,
  ThumbnailGeneratorPort,
  LinkPreviewFetcherPort,
} from './domain/inbox/index.js';

/**
 * Configuration for service initialization.
 */
export interface ServiceConfig {
  mediaBucket: string;
  gcpProjectId: string;
  mediaCleanupTopic: string;
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
 * Get or create the service container.
 * Requires initServices() to be called first in production.
 */
export function getServices(): ServiceContainer {
  container ??= {
    webhookEventRepository: new WebhookEventRepositoryAdapter(),
    userMappingRepository: new UserMappingRepositoryAdapter(),
    messageRepository: new MessageRepositoryAdapter(),
    mediaStorage: new GcsMediaStorageAdapter(serviceConfig?.mediaBucket ?? 'test-bucket'),
    eventPublisher: new GcpPubSubPublisher(
      serviceConfig?.gcpProjectId ?? 'test-project',
      serviceConfig?.mediaCleanupTopic ?? 'test-media-cleanup'
    ),
    messageSender: new WhatsAppCloudApiSender(
      serviceConfig?.whatsappAccessToken ?? 'test-token',
      serviceConfig?.whatsappPhoneNumberId ?? 'test-phone-id'
    ),
    transcriptionService: new SpeechmaticsTranscriptionAdapter(
      serviceConfig?.speechmaticsApiKey ?? 'test-api-key'
    ),
    whatsappCloudApi: new WhatsAppCloudApiAdapter(
      serviceConfig?.whatsappAccessToken ?? 'test-token'
    ),
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

// Re-export infra functions for direct use
export * from './infra/firestore/index.js';
