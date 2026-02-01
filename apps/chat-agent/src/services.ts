/**
 * Service wiring for chat-agent.
 * Provides dependency injection for domain adapters.
 */

import { createAppLogger } from '@intexuraos/infra-sentry';
import { LlmModels } from '@intexuraos/llm-contract';
import { FirestoreEmbeddingRepository } from './infra/firestore/embeddingRepository.js';
import { EmbeddingClient } from './infra/llm/embeddingClient.js';
import { ChatClient } from './infra/llm/chatClient.js';
import type { EmbeddingRepositoryPort } from './domain/models/docChunk.js';
import type { EmbeddingClient as EmbeddingClientInterface } from './domain/usecases/searchDocumentation.js';
import type { LLMClient } from './domain/usecases/generateResponse.js';
import type { Logger } from 'pino';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  readonly generateId: () => string;
  readonly embeddingRepository: EmbeddingRepositoryPort;
  readonly embeddingClient: EmbeddingClientInterface;
  readonly llmClient: LLMClient;
  readonly logger: Logger;
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
  const openaiApiKey = process.env['INTEXURAOS_OPENAI_API_KEY'];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- LlmModels from llm-contract
  const model = process.env['INTEXURAOS_LLM_MODEL'] ?? LlmModels.Gemini25Flash;

  if (openaiApiKey === undefined || openaiApiKey.length === 0) {
    throw new Error('INTEXURAOS_OPENAI_API_KEY environment variable is required');
  }

  const logger = createAppLogger({
    name: 'chat-agent',
    level: (process.env['LOG_LEVEL'] ?? 'info') as 'error' | 'info' | 'warn' | 'debug' | 'silent',
  });

  container = {
    generateId: (): string => crypto.randomUUID(),
    embeddingRepository: new FirestoreEmbeddingRepository(),
    embeddingClient: new EmbeddingClient({ apiKey: openaiApiKey }),
    llmClient: new ChatClient({
      apiKey: openaiApiKey,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Model string from env var or LlmModels constant
      model,
      userId: 'system',
      logger,
    }),
    logger,
  };
}
