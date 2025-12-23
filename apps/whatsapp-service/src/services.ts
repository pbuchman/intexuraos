/**
 * Service wiring for whatsapp-service.
 * Provides class-based adapters for domain use cases.
 */
import {
  WebhookEventRepositoryAdapter,
  UserMappingRepositoryAdapter,
  NotionConnectionRepositoryAdapter,
} from './adapters.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  webhookEventRepository: WebhookEventRepositoryAdapter;
  userMappingRepository: UserMappingRepositoryAdapter;
  notionConnectionRepository: NotionConnectionRepositoryAdapter;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 */
export function getServices(): ServiceContainer {
  container ??= {
    webhookEventRepository: new WebhookEventRepositoryAdapter(),
    userMappingRepository: new UserMappingRepositoryAdapter(),
    notionConnectionRepository: new NotionConnectionRepositoryAdapter(),
  };
  return container;
}

/**
 * Set a custom service container (for testing).
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

// Re-export infra functions for direct use
export * from './infra/firestore/index.js';
export { createInboxNote } from './infra/notion/index.js';
