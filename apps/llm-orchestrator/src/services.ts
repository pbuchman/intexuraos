/**
 * Service wiring for llm-orchestrator.
 * Provides dependency injection for domain adapters.
 *
 * Note: LLM usage logging is handled by the clients in packages/infra-*.
 */

import { FirestoreResearchRepository } from './infra/research/index.js';
import { FirestorePricingRepository } from './infra/pricing/index.js';
import {
  createContextInferrer,
  createInputValidator,
  createResearchProvider,
  createSynthesizer,
  createTitleGenerator,
} from './infra/llm/index.js';
import { NoopNotificationSender, WhatsAppNotificationSender } from './infra/notification/index.js';
import { createShareStorage } from './infra/gcs/index.js';
import {
  createLlmCallPublisher,
  createResearchEventPublisher,
  type LlmCallPublisher,
  type ResearchEventPublisher,
} from './infra/pubsub/index.js';
import { createUserServiceClient, type UserServiceClient } from './infra/user/index.js';
import { createImageServiceClient, type ImageServiceClient } from './infra/image/index.js';

export type { DecryptedApiKeys } from './infra/user/index.js';
export type { ImageServiceClient, GeneratedImageData } from './infra/image/index.js';
import type { Logger } from '@intexuraos/common-core';
import type { ModelPricing, ResearchModel, FastModel } from '@intexuraos/llm-contract';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import {
  type LlmResearchProvider,
  type LlmSynthesisProvider,
  type NotificationSender,
  type PricingRepository,
  type ResearchRepository,
  type ShareStoragePort,
  type TitleGenerator,
} from './domain/research/index.js';
import type { ContextInferenceProvider } from './domain/research/ports/contextInference.js';
import type { InputValidationProvider } from './infra/llm/index.js';

/**
 * Configuration for sharing features.
 */
export interface ShareConfig {
  shareBaseUrl: string;
  staticAssetsUrl: string;
}

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  researchRepo: ResearchRepository;
  pricingRepo: PricingRepository;
  pricingContext: IPricingContext;
  generateId: () => string;
  researchEventPublisher: ResearchEventPublisher;
  llmCallPublisher: LlmCallPublisher;
  userServiceClient: UserServiceClient;
  imageServiceClient: ImageServiceClient | null;
  notificationSender: NotificationSender;
  shareStorage: ShareStoragePort | null;
  shareConfig: ShareConfig | null;
  webAppUrl: string;
  createResearchProvider: (
    model: ResearchModel,
    apiKey: string,
    userId: string,
    pricing: ModelPricing,
    logger?: Logger
  ) => LlmResearchProvider;
  createSynthesizer: (
    model: ResearchModel,
    apiKey: string,
    userId: string,
    pricing: ModelPricing
  ) => LlmSynthesisProvider;
  createTitleGenerator: (
    model: FastModel,
    apiKey: string,
    userId: string,
    pricing: ModelPricing
  ) => TitleGenerator;
  createContextInferrer: (
    model: FastModel,
    apiKey: string,
    userId: string,
    pricing: ModelPricing,
    logger?: Logger
  ) => ContextInferenceProvider;
  createInputValidator: (
    model: FastModel,
    apiKey: string,
    userId: string,
    pricing: ModelPricing
  ) => InputValidationProvider;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 * Throws if container has not been initialized.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initializeServices() first.');
  }
  return container;
}

/**
 * Set a custom service container (for testing or initialization).
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

/**
 * Create the notification sender based on environment configuration.
 * Uses Pub/Sub to send messages via whatsapp-service.
 * Phone number lookup is handled internally by whatsapp-service.
 */
function createNotificationSender(): NotificationSender {
  const gcpProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
  const whatsappSendTopic = process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'];

  if (
    gcpProjectId !== undefined &&
    gcpProjectId !== '' &&
    whatsappSendTopic !== undefined &&
    whatsappSendTopic !== ''
  ) {
    return new WhatsAppNotificationSender({
      projectId: gcpProjectId,
      topicName: whatsappSendTopic,
    });
  }

  return new NoopNotificationSender();
}

/**
 * Create share storage and config if environment variables are set.
 */
function createShareStorageAndConfig(): {
  shareStorage: ShareStoragePort | null;
  shareConfig: ShareConfig | null;
} {
  const bucketName = process.env['INTEXURAOS_SHARED_CONTENT_BUCKET'];
  const shareBaseUrl = process.env['INTEXURAOS_SHARE_BASE_URL'];
  const gcpProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];

  if (
    bucketName !== undefined &&
    bucketName !== '' &&
    shareBaseUrl !== undefined &&
    shareBaseUrl !== ''
  ) {
    const staticAssetsUrl = `https://storage.googleapis.com/intexuraos-static-assets-${gcpProjectId?.includes('dev') === true ? 'dev' : 'prod'}`;

    return {
      shareStorage: createShareStorage({ bucketName }),
      shareConfig: { shareBaseUrl, staticAssetsUrl },
    };
  }

  return { shareStorage: null, shareConfig: null };
}

/**
 * Initialize the service container with all dependencies.
 */
export function initializeServices(pricingContext: IPricingContext): void {
  const researchRepo = new FirestoreResearchRepository();
  const pricingRepo = new FirestorePricingRepository();

  const userServiceClient = createUserServiceClient({
    baseUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] ?? 'http://localhost:8081',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
  });

  const notificationSender = createNotificationSender();

  const researchEventPublisher = createResearchEventPublisher({
    projectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    topicName: process.env['INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC'] ?? '',
  });

  const llmCallPublisher = createLlmCallPublisher({
    projectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    topicName: process.env['INTEXURAOS_PUBSUB_LLM_CALL_TOPIC'] ?? '',
  });

  const { shareStorage, shareConfig } = createShareStorageAndConfig();

  const imageServiceUrl = process.env['INTEXURAOS_IMAGE_SERVICE_URL'];
  const imageServiceClient =
    imageServiceUrl !== undefined && imageServiceUrl !== ''
      ? createImageServiceClient({
          baseUrl: imageServiceUrl,
          internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
        })
      : null;

  container = {
    researchRepo,
    pricingRepo,
    pricingContext,
    generateId: (): string => crypto.randomUUID(),
    researchEventPublisher,
    llmCallPublisher,
    userServiceClient,
    imageServiceClient,
    notificationSender,
    shareStorage,
    shareConfig,
    webAppUrl: process.env['INTEXURAOS_WEB_APP_URL'] ?? '',
    createResearchProvider,
    createSynthesizer,
    createTitleGenerator,
    createContextInferrer,
    createInputValidator,
  };
}
