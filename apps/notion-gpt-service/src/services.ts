/**
 * Service container for notion-gpt-service.
 * Provides dependency injection for adapters.
 */
import type { NotionConnectionRepository, NotionApiPort } from '@praxos/domain-promptvault';
import { FirestoreNotionConnectionRepository } from '@praxos/infra-firestore';
import { NotionApiAdapter } from '@praxos/infra-notion';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  connectionRepository: NotionConnectionRepository;
  notionApi: NotionApiPort;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 * In production, uses real Firestore and Notion adapters.
 */
export function getServices(): ServiceContainer {
  container ??= {
    connectionRepository: new FirestoreNotionConnectionRepository(),
    notionApi: new NotionApiAdapter(),
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
