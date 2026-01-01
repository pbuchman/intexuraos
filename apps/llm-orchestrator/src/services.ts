/**
 * Service wiring for llm-orchestrator.
 * Provides dependency injection for domain adapters.
 */

import { FirestoreResearchRepository } from './infra/research/index.js';
import { createLlmProviders, createSynthesizer, createTitleGenerator } from './infra/llm/index.js';
import { NoopNotificationSender, WhatsAppNotificationSender } from './infra/notification/index.js';
import {
  createUserServiceClient,
  type DecryptedApiKeys,
  type UserServiceClient,
} from './infra/user/index.js';
import { getErrorMessage } from '@intexuraos/common-core';
import {
  type NotificationSender,
  processResearch,
  type ResearchRepository,
  type TitleGenerator,
} from './domain/research/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  researchRepo: ResearchRepository;
  generateId: () => string;
  processResearchAsync: (researchId: string) => void;
  userServiceClient: UserServiceClient;
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

  // Create user service client for fetching API keys and phone numbers
  const userServiceClient = createUserServiceClient({
    baseUrl: process.env['USER_SERVICE_URL'] ?? 'http://localhost:8081',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
  });

  const notificationSender = createNotificationSender(userServiceClient);

  /**
   * Process research asynchronously (fire and forget).
   */
  const processResearchAsync = (researchId: string): void => {
    void (async (): Promise<void> => {
      try {
        // Get research to find user ID and synthesis LLM selection
        const researchResult = await researchRepo.findById(researchId);
        if (!researchResult.ok || researchResult.value === null) {
          return;
        }
        const research = researchResult.value;

        // Get user's API keys
        const apiKeysResult = await userServiceClient.getApiKeys(research.userId);
        const apiKeys: DecryptedApiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

        // Get the API key for the selected synthesis LLM
        const synthesisProvider = research.synthesisLlm;
        const synthesisKey = apiKeys[synthesisProvider];
        if (synthesisKey === undefined) {
          await researchRepo.update(researchId, {
            status: 'failed',
            synthesisError: `API key required for synthesis with ${synthesisProvider}`,
          });
          return;
        }

        // Create LLM providers with user's keys
        const llmProviders = createLlmProviders(apiKeys);
        const synthesizer = createSynthesizer(synthesisProvider, synthesisKey);

        // Build deps for processing
        const deps: Parameters<typeof processResearch>[1] = {
          researchRepo,
          llmProviders,
          synthesizer,
          notificationSender,
          reportLlmSuccess: (provider): void => {
            void userServiceClient.reportLlmSuccess(research.userId, provider);
          },
        };

        // Use Gemini for title generation if available (cheapest option)
        if (apiKeys.google !== undefined) {
          deps.titleGenerator = createTitleGenerator(apiKeys.google);
        }

        // Process research
        await processResearch(researchId, deps);
      } catch (error) {
        /* Fire-and-forget: log error but don't throw */
        const message = getErrorMessage(error);
        // eslint-disable-next-line no-console
        console.error('Error processing research:', message);
      }
    })();
  };

  container = {
    researchRepo,
    generateId: (): string => crypto.randomUUID(),
    processResearchAsync,
    userServiceClient,
    createTitleGenerator,
  };
}
