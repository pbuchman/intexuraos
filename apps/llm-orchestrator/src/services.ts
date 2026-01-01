/**
 * Service wiring for llm-orchestrator.
 * Provides dependency injection for domain adapters.
 */

import { FirestoreResearchRepository } from './infra/research/index.js';
import { createLlmProviders, createSynthesizer, createTitleGenerator } from './infra/llm/index.js';
import { NoopNotificationSender, WhatsAppNotificationSender } from './infra/notification/index.js';
import { createResearchEventPublisher, type ResearchEventPublisher } from './infra/pubsub/index.js';
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
  type ResearchRepository,
  type TitleGenerator,
} from './domain/research/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  researchRepo: ResearchRepository;
  generateId: () => string;
  researchEventPublisher: ResearchEventPublisher;
  userServiceClient: UserServiceClient;
  notificationSender: NotificationSender;
  createLlmProviders: (apiKeys: InfraDecryptedApiKeys) => Record<LlmProvider, LlmResearchProvider>;
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
 */
function createNotificationSender(userServiceClient: UserServiceClient): NotificationSender {
  const gcpProjectId = process.env['GOOGLE_CLOUD_PROJECT'];
  const whatsappSendTopic = process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'];

  if (
    gcpProjectId !== undefined &&
    gcpProjectId !== '' &&
    whatsappSendTopic !== undefined &&
    whatsappSendTopic !== ''
  ) {
    return new WhatsAppNotificationSender(
      {
        projectId: gcpProjectId,
        topicName: whatsappSendTopic,
      },
      {
        getPhoneNumber: async (userId: string): Promise<string | null> => {
          const result = await userServiceClient.getWhatsAppPhone(userId);
          return result.ok ? result.value : null;
        },
      }
    );
  }

  return new NoopNotificationSender();
}

/**
 * Initialize the service container with all dependencies.
 */
export function initializeServices(): void {
  const researchRepo = new FirestoreResearchRepository();

  const userServiceClient = createUserServiceClient({
    baseUrl: process.env['USER_SERVICE_URL'] ?? 'http://localhost:8081',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
  });

  const notificationSender = createNotificationSender(userServiceClient);

  const researchEventPublisher = createResearchEventPublisher({
    projectId: process.env['GOOGLE_CLOUD_PROJECT'] ?? '',
    topicName: process.env['INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC'] ?? '',
  });

  container = {
    researchRepo,
    generateId: (): string => crypto.randomUUID(),
    researchEventPublisher,
    userServiceClient,
    notificationSender,
    createLlmProviders,
    createSynthesizer,
    createTitleGenerator,
  };
}
