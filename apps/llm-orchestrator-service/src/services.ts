/**
 * Service wiring for llm-orchestrator-service.
 * Provides dependency injection for domain adapters.
 */

import { Firestore } from '@google-cloud/firestore';
import { FirestoreResearchRepository } from './infra/research/index.js';
import { createLlmProviders, createSynthesizer, type DecryptedApiKeys } from './infra/llm/index.js';
import { NoopNotificationSender, WhatsAppNotificationSender } from './infra/notification/index.js';
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
 * Fetch user's decrypted API keys from user-service.
 */
async function getUserApiKeys(userId: string): Promise<DecryptedApiKeys> {
  const userServiceUrl = process.env['USER_SERVICE_URL'] ?? 'http://localhost:8081';
  const internalAuthToken = process.env['INTERNAL_AUTH_TOKEN'] ?? '';

  try {
    const response = await fetch(`${userServiceUrl}/internal/users/${userId}/llm-keys`, {
      headers: {
        'X-Internal-Auth': internalAuthToken,
      },
    });

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error(`Failed to fetch API keys for user ${userId}: HTTP ${String(response.status)}`);
      return {};
    }

    const data = (await response.json()) as {
      google?: string | null;
      openai?: string | null;
      anthropic?: string | null;
    };

    // Convert null values to undefined (null is used by JSON to distinguish from missing)
    const result: DecryptedApiKeys = {};
    if (data.google !== null && data.google !== undefined) {
      result.google = data.google;
    }
    if (data.openai !== null && data.openai !== undefined) {
      result.openai = data.openai;
    }
    if (data.anthropic !== null && data.anthropic !== undefined) {
      result.anthropic = data.anthropic;
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // eslint-disable-next-line no-console
    console.error(`Error fetching API keys for user ${userId}: ${message}`);
    return {};
  }
}

/**
 * Fetch user's WhatsApp phone number from user-service.
 */
async function getUserWhatsAppPhone(userId: string): Promise<string | null> {
  const userServiceUrl = process.env['USER_SERVICE_URL'] ?? 'http://localhost:8081';
  const internalAuthToken = process.env['INTERNAL_AUTH_TOKEN'] ?? '';

  try {
    const response = await fetch(`${userServiceUrl}/internal/users/${userId}/whatsapp-phone`, {
      headers: {
        'X-Internal-Auth': internalAuthToken,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { phone?: string };
    return data.phone ?? null;
  } catch {
    return null;
  }
}

/**
 * Create the notification sender based on environment configuration.
 */
function createNotificationSender(): NotificationSender {
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
        getPhoneNumber: getUserWhatsAppPhone,
      }
    );
  }

  return new NoopNotificationSender();
}

/**
 * Initialize the service container with all dependencies.
 */
export function initializeServices(): void {
  const firestore = new Firestore();
  const researchRepo = new FirestoreResearchRepository(firestore);
  const notificationSender = createNotificationSender();

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
        const apiKeys = await getUserApiKeys(research.value.userId);

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
