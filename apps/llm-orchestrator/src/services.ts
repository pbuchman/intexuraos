/**
 * Service wiring for llm-orchestrator.
 * Provides dependency injection for domain adapters.
 */

import { FirestoreResearchRepository } from './infra/research/index.js';
import { FirestorePricingRepository } from './infra/pricing/index.js';
import {
  createLlmProviders,
  createResearchProvider,
  createSynthesizer,
  createTitleGenerator,
} from './infra/llm/index.js';
import { NoopNotificationSender, WhatsAppNotificationSender } from './infra/notification/index.js';
import {
  createLlmCallPublisher,
  createResearchEventPublisher,
  type LlmCallPublisher,
  type ResearchEventPublisher,
} from './infra/pubsub/index.js';
import {
  createUserServiceClient,
  type DecryptedApiKeys as InfraDecryptedApiKeys,
  type UserServiceClient,
} from './infra/user/index.js';

export type { DecryptedApiKeys } from './infra/user/index.js';
import {
  type LlmProvider,
  type LlmResearchProvider,
  type LlmSynthesisProvider,
  type NotificationSender,
  type PricingRepository,
  type ResearchRepository,
  type SearchMode,
  type TitleGenerator,
} from './domain/research/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  researchRepo: ResearchRepository;
  pricingRepo: PricingRepository;
  generateId: () => string;
  researchEventPublisher: ResearchEventPublisher;
  llmCallPublisher: LlmCallPublisher;
  userServiceClient: UserServiceClient;
  notificationSender: NotificationSender;
  createLlmProviders: (
    apiKeys: InfraDecryptedApiKeys,
    searchMode?: SearchMode
  ) => Record<LlmProvider, LlmResearchProvider>;
  createResearchProvider: (
    provider: LlmProvider,
    apiKey: string,
    searchMode?: SearchMode
  ) => LlmResearchProvider;
  createSynthesizer: (provider: LlmProvider, apiKey: string) => LlmSynthesisProvider;
  createTitleGenerator: (apiKey: string) => TitleGenerator;
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
 * Initialize the service container with all dependencies.
 */
export function initializeServices(): void {
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

  container = {
    researchRepo,
    pricingRepo,
    generateId: (): string => crypto.randomUUID(),
    researchEventPublisher,
    llmCallPublisher,
    userServiceClient,
    notificationSender,
    createLlmProviders,
    createResearchProvider,
    createSynthesizer,
    createTitleGenerator,
  };
}
