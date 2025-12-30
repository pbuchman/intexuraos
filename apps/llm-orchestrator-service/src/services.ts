/**
 * Service wiring for llm-orchestrator-service.
 * Provides dependency injection for domain adapters.
 */

import { FirestoreResearchRepository } from './infra/research/index.js';
import { createLlmProviders, createSynthesizer } from './infra/llm/index.js';
import { NoopNotificationSender, WhatsAppNotificationSender } from './infra/notification/index.js';
import {
  createUserServiceClient,
  type UserServiceClient,
  type DecryptedApiKeys,
} from './infra/user/index.js';
import {
  processResearch,
  type ResearchRepository,
  type NotificationSender,
} from './domain/research/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  researchRepo: ResearchRepository;
  generateId: () => string;
  processResearchAsync: (researchId: string) => void;
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
 */
function createNotificationSender(userServiceClient: UserServiceClient): NotificationSender {
  const whatsappAccessToken = process.env['WHATSAPP_ACCESS_TOKEN'];
  const whatsappPhoneNumberId = process.env['WHATSAPP_PHONE_NUMBER_ID'];

  if (
    whatsappAccessToken !== undefined &&
    whatsappAccessToken !== '' &&
    whatsappPhoneNumberId !== undefined &&
    whatsappPhoneNumberId !== ''
  ) {
    return new WhatsAppNotificationSender(
      {
        accessToken: whatsappAccessToken,
        phoneNumberId: whatsappPhoneNumberId,
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
    internalAuthToken: process.env['INTERNAL_AUTH_TOKEN'] ?? '',
  });

  const notificationSender = createNotificationSender(userServiceClient);

  /**
   * Process research asynchronously (fire and forget).
   */
  const processResearchAsync = (researchId: string): void => {
    void (async (): Promise<void> => {
      try {
        // Get research to find user ID and synthesis LLM selection
        const research = await researchRepo.findById(researchId);
        if (!research.ok || research.value === null) {
          return;
        }

        // Get user's API keys
        const apiKeysResult = await userServiceClient.getApiKeys(research.value.userId);
        const apiKeys: DecryptedApiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

        // Get the API key for the selected synthesis LLM
        const synthesisProvider = research.value.synthesisLlm;
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

        // Process research
        await processResearch(researchId, {
          researchRepo,
          llmProviders,
          synthesizer,
          notificationSender,
        });
      } catch (error) {
        /* Fire-and-forget: log error but don't throw */
        const message = error instanceof Error ? error.message : 'Unknown error';
        // eslint-disable-next-line no-console
        console.error('Error processing research:', message);
      }
    })();
  };

  container = {
    researchRepo,
    generateId: (): string => crypto.randomUUID(),
    processResearchAsync,
  };
}
