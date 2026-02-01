/**
 * Service wiring for chat-agent.
 * Provides dependency injection for domain adapters.
 */

import { FirestoreEmbeddingRepository } from './infra/firestore/embeddingRepository.js';
import { EmbeddingClient } from './infra/llm/embeddingClient.js';
import type { EmbeddingRepositoryPort } from './domain/models/docChunk.js';
import type { EmbeddingClient as EmbeddingClientInterface } from './domain/usecases/searchDocumentation.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  readonly generateId: () => string;
  readonly embeddingRepository: EmbeddingRepositoryPort;
  readonly embeddingClient: EmbeddingClientInterface;
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

  if (openaiApiKey === undefined || openaiApiKey.length === 0) {
    throw new Error('INTEXURAOS_OPENAI_API_KEY environment variable is required');
  }

  container = {
    generateId: (): string => crypto.randomUUID(),
    embeddingRepository: new FirestoreEmbeddingRepository(),
    embeddingClient: new EmbeddingClient({ apiKey: openaiApiKey }),
  };
}
