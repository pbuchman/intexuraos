/**
 * Service wiring for mobile-notifications-service.
 * Provides dependency injection for domain adapters.
 */
import type {
  NotificationRepository,
  SignatureConnectionRepository,
} from './domain/notifications/index.js';
import type { NotificationFiltersRepository } from './domain/filters/index.js';
import type {
  DigestRepository,
  GroupStateRepository,
  DigestLockRepository,
} from './domain/repositories/digestRepositories.js';
import { FirestoreSignatureConnectionRepository } from './infra/firestore/firestoreSignatureConnectionRepository.js';
import { FirestoreNotificationRepository } from './infra/firestore/firestoreNotificationRepository.js';
import { FirestoreNotificationFiltersRepository } from './infra/firestore/notificationFiltersRepository.js';
import { FirestoreDigestRepository } from './infra/firestore/firestoreDigestRepository.js';
import { FirestoreGroupStateRepository } from './infra/firestore/firestoreGroupStateRepository.js';
import { FirestoreDigestLockRepository } from './infra/firestore/firestoreDigestLockRepository.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  signatureConnectionRepository: SignatureConnectionRepository;
  notificationRepository: NotificationRepository;
  notificationFiltersRepository: NotificationFiltersRepository;
  digestRepository: DigestRepository;
  groupStateRepository: GroupStateRepository;
  digestLockRepository: DigestLockRepository;
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
    digestRepository: new FirestoreDigestRepository(),
    groupStateRepository: new FirestoreGroupStateRepository(),
    digestLockRepository: new FirestoreDigestLockRepository(),
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
