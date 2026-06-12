/**
 * Service wiring for chat-agent.
 * Provides dependency injection for domain adapters.
 */

import { createAppLogger } from '@intexuraos/infra-sentry';
import { createUserServiceClient, type UserServiceClient } from '@intexuraos/internal-clients';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { LlmModels } from '@intexuraos/llm-contract';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import { FirestoreEmbeddingRepository } from './infra/firestore/embeddingRepository.js';
import { EmbeddingClient } from './infra/llm/embeddingClient.js';
import { createChatClient } from './infra/llm/chatClient.js';
import { createGuestRateLimiter, type GuestRateLimiter } from './infra/rateLimit/index.js';
import {
  createGuestSessionSigner,
  type GuestSessionSigner,
} from './infra/guestSession/index.js';
import OpenAI from 'openai';
import type { CreateEmbeddingResponse } from 'openai/resources';
import type { EmbeddingRepositoryPort } from './domain/models/docChunk.js';
import type { EmbeddingClient as EmbeddingClientInterface } from './domain/usecases/searchDocumentation.js';
import type { Logger } from 'pino';

// Re-export createChatClient for use in routes (via services layer)
export { createChatClient };

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
  readonly guestSessionSigner: GuestSessionSigner;
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
 */
export function initializeServices(): void {
  const openaiApiKey = process.env['INTEXURAOS_OPENAI_APP_API_KEY'];
  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'];
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  const llmUsageServiceUrl = process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'];
  const guestGeminiApiKey = process.env['INTEXURAOS_GEMINI_APP_API_KEY'];

  if (openaiApiKey === undefined || openaiApiKey.length === 0) {
    throw new Error('INTEXURAOS_OPENAI_APP_API_KEY environment variable is required');
  }

  if (userServiceUrl === undefined || userServiceUrl.length === 0) {
    throw new Error('INTEXURAOS_USER_SERVICE_URL environment variable is required');
  }

  if (internalAuthToken === undefined || internalAuthToken.length === 0) {
    throw new Error('INTEXURAOS_INTERNAL_AUTH_TOKEN environment variable is required');
  }

  if (llmUsageServiceUrl === undefined || llmUsageServiceUrl.length === 0) {
    throw new Error('INTEXURAOS_LLM_USAGE_SERVICE_URL environment variable is required');
  }

  if (guestGeminiApiKey === undefined || guestGeminiApiKey.length === 0) {
    throw new Error('INTEXURAOS_GEMINI_APP_API_KEY environment variable is required for guest access');
  }

  const guestSessionSecret = process.env['INTEXURAOS_GUEST_SESSION_SECRET'];
  if (guestSessionSecret === undefined || guestSessionSecret.length < 32) {
    throw new Error(
      'INTEXURAOS_GUEST_SESSION_SECRET environment variable is required and must be at least 32 bytes'
    );
  }

  const logger = createAppLogger({
    name: 'chat-agent',
    level: (process.env['LOG_LEVEL'] ?? 'info') as 'error' | 'info' | 'warn' | 'debug' | 'silent',
  });

  // Create OpenAI instance for embeddings
  const openai = new OpenAI({ apiKey: openaiApiKey });

  const guestUsageSink = new HttpInternalAuthUsageSink({
    usageServiceUrl: llmUsageServiceUrl,
    internalAuthToken,
    service: 'chat-agent',
    component: 'guest-chat',
    logger,
  });

  const userServiceUsageSink = new HttpInternalAuthUsageSink({
    usageServiceUrl: llmUsageServiceUrl,
    internalAuthToken,
    service: 'chat-agent',
    component: 'user-service-client',
    logger,
  });

  // Create guest LLM client with platform-owned Gemini API key
  const guestLlmClient = createLlmClient({
    apiKey: guestGeminiApiKey,
    model: LlmModels.Gemini25Flash,
    userId: 'guest',
    logger,
    usageSink: guestUsageSink,
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
      logger,
      usageSink: userServiceUsageSink,
      platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
    }),
    logger,
    guestRateLimiter: createGuestRateLimiter(),
    guestLlmClient,
    guestSessionSigner: createGuestSessionSigner({
      secret: guestSessionSecret,
      ttlSeconds: 24 * 60 * 60, // 24h
    }),
  };
}
