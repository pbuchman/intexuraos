/**
 * Service wiring for mobile-notifications-service.
 * Provides dependency injection for domain adapters.
 */
import type {
  NotificationRepository,
  SignatureConnectionRepository,
} from './domain/notifications/index.js';
import type { NotificationFiltersRepository } from './domain/filters/index.js';
import { FirestoreSignatureConnectionRepository } from './infra/firestore/firestoreSignatureConnectionRepository.js';
import { FirestoreNotificationRepository } from './infra/firestore/firestoreNotificationRepository.js';
import { FirestoreNotificationFiltersRepository } from './infra/firestore/notificationFiltersRepository.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  signatureConnectionRepository: SignatureConnectionRepository;
  notificationRepository: NotificationRepository;
  notificationFiltersRepository: NotificationFiltersRepository;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 */
export function getServices(): ServiceContainer {
  container ??= {
    signatureConnectionRepository: new FirestoreSignatureConnectionRepository(),
    notificationRepository: new FirestoreNotificationRepository(),
    notificationFiltersRepository: new FirestoreNotificationFiltersRepository(),
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
