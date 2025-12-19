/**
 * Service container for whatsapp-service.
 * Provides dependency injection for adapters.
 */
import type { WhatsAppWebhookEventRepository } from '@praxos/infra-firestore';
import { FirestoreWhatsAppWebhookEventRepository } from '@praxos/infra-firestore';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  webhookEventRepository: WhatsAppWebhookEventRepository;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 * In production, uses real Firestore adapters.
 */
export function getServices(): ServiceContainer {
  container ??= {
    webhookEventRepository: new FirestoreWhatsAppWebhookEventRepository(),
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
