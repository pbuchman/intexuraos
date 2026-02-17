/**
 * Service wiring for chat-agent.
 * Provides dependency injection for domain adapters.
 */

import { createAppLogger } from '@intexuraos/infra-sentry';
import { createUserServiceClient, type UserServiceClient } from '@intexuraos/internal-clients';
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels } from '@intexuraos/llm-contract';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import { FirestoreEmbeddingRepository } from './infra/firestore/embeddingRepository.js';
import { EmbeddingClient } from './infra/llm/embeddingClient.js';
import { createChatClient } from './infra/llm/chatClient.js';
import { createGuestRateLimiter, type GuestRateLimiter } from './infra/rateLimit/index.js';
import OpenAI from 'openai';
import type { CreateEmbeddingResponse } from 'openai/resources';
import type { EmbeddingRepositoryPort } from './domain/models/docChunk.js';
import type { EmbeddingClient as EmbeddingClientInterface } from './domain/usecases/searchDocumentation.js';
import type { Logger } from 'pino';

// Re-export createChatClient for use in routes (via services layer)
export { createChatClient };

/**
 * Models supported for chat responses.
 * These are validated at startup to ensure pricing is available.
 */
const CHAT_MODELS = [
  LlmModels.Gemini25Flash,
  LlmModels.Glm47,
  LlmModels.Glm47Flash,
] as const;

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  readonly generateId: () => string;
  readonly embeddingRepository: EmbeddingRepositoryPort;
  readonly embeddingClient: EmbeddingClientInterface;
  readonly userServiceClient: UserServiceClient;
  readonly logger: Logger;
  readonly guestRateLimiter: GuestRateLimiter;
  readonly guestLlmClient: LlmGenerateClient;
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
 * Initialize the service container with all dependencies.
 * Fetches pricing data from app-settings-service at startup.
 */
export async function initializeServices(): Promise<void> {
  const openaiApiKey = process.env['INTEXURAOS_OPENAI_APP_API_KEY'];
  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'];
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  const appSettingsServiceUrl = process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'];
  const guestZaiApiKey = process.env['INTEXURAOS_ZAI_APP_API_KEY'];

  if (openaiApiKey === undefined || openaiApiKey.length === 0) {
    throw new Error('INTEXURAOS_OPENAI_APP_API_KEY environment variable is required');
  }

  if (userServiceUrl === undefined || userServiceUrl.length === 0) {
    throw new Error('INTEXURAOS_USER_SERVICE_URL environment variable is required');
  }

  if (internalAuthToken === undefined || internalAuthToken.length === 0) {
    throw new Error('INTEXURAOS_INTERNAL_AUTH_TOKEN environment variable is required');
  }

  if (appSettingsServiceUrl === undefined || appSettingsServiceUrl.length === 0) {
    throw new Error('INTEXURAOS_APP_SETTINGS_SERVICE_URL environment variable is required');
  }

  if (guestZaiApiKey === undefined || guestZaiApiKey.length === 0) {
    throw new Error('INTEXURAOS_ZAI_APP_API_KEY environment variable is required');
  }

  const logger = createAppLogger({
    name: 'chat-agent',
    level: (process.env['LOG_LEVEL'] ?? 'info') as 'error' | 'info' | 'warn' | 'debug' | 'silent',
  });

  // Fetch pricing data from app-settings-service
  const pricingResult = await fetchAllPricing(appSettingsServiceUrl, internalAuthToken);

  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  const pricingContext = createPricingContext(
    pricingResult.value,
    [...CHAT_MODELS] as unknown as (typeof LlmModels.Gemini25Flash)[]
  );

  // Create OpenAI instance for embeddings
  const openai = new OpenAI({ apiKey: openaiApiKey });

  // Create guest LLM client with platform-owned Zai API key (GLM-4.7-Flash at $0 cost)
  const guestLlmClient = createLlmClient({
    apiKey: guestZaiApiKey,
    model: LlmModels.Glm47Flash,
    userId: 'guest',
    pricing: pricingContext.getPricing(LlmModels.Glm47Flash),
    logger,
  });

  container = {
    generateId: (): string => crypto.randomUUID(),
    embeddingRepository: new FirestoreEmbeddingRepository(),
    embeddingClient: new EmbeddingClient({
      embedFn: (text: string, model: string): Promise<CreateEmbeddingResponse> =>
        openai.embeddings.create({ model, input: text }),
    }),
    userServiceClient: createUserServiceClient({
      baseUrl: userServiceUrl,
      internalAuthToken,
      pricingContext,
      logger,
      platformZaiApiKey: process.env['INTEXURAOS_ZAI_APP_API_KEY'],
      platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
    }),
    logger,
    guestRateLimiter: createGuestRateLimiter(),
    guestLlmClient,
  };
}
