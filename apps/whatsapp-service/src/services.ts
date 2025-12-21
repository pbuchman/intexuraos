/**
 * Service container for whatsapp-service.
 * Provides dependency injection for adapters.
 */
import type {
  WhatsAppWebhookEventRepository,
  WhatsAppUserMappingRepository,
} from '@praxos/domain-inbox';
import {
  FirestoreWhatsAppWebhookEventRepository,
  FirestoreWhatsAppUserMappingRepository,
} from '@praxos/infra-firestore';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  userMappingRepository: WhatsAppUserMappingRepository;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 * In production, uses real Firestore adapters.
 */
export function getServices(): ServiceContainer {
  container ??= {
    webhookEventRepository: new FirestoreWhatsAppWebhookEventRepository(),
    userMappingRepository: new FirestoreWhatsAppUserMappingRepository(),
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
