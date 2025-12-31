/**
 * Service wiring for mobile-notifications-service.
 * Provides dependency injection for domain adapters.
 */
import type { NotificationRepository, SignatureConnectionRepository, } from './domain/notifications/index.js';
import { FirestoreSignatureConnectionRepository } from './infra/firestore/firestoreSignatureConnectionRepository.js';
import { FirestoreNotificationRepository } from './infra/firestore/firestoreNotificationRepository.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  signatureConnectionRepository: SignatureConnectionRepository;
  notificationRepository: NotificationRepository;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 */
export function getServices(): ServiceContainer {
  container ??= {
    signatureConnectionRepository: new FirestoreSignatureConnectionRepository(),
    notificationRepository: new FirestoreNotificationRepository(),
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
