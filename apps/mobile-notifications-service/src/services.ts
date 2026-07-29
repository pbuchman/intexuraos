import type {
  NotificationRepository,
  SignatureConnectionRepository,
} from './domain/notifications/index.js';
import type { NotificationFiltersRepository } from './domain/filters/index.js';
import { FirestoreSignatureConnectionRepository } from './infra/firestore/firestoreSignatureConnectionRepository.js';
import { FirestoreNotificationRepository } from './infra/firestore/firestoreNotificationRepository.js';
import { FirestoreNotificationFiltersRepository } from './infra/firestore/notificationFiltersRepository.js';

export interface ServiceContainer {
  signatureConnectionRepository: SignatureConnectionRepository;
  notificationRepository: NotificationRepository;
  notificationFiltersRepository: NotificationFiltersRepository;
}

let container: ServiceContainer | null = null;

export function getServices(): ServiceContainer {
  container ??= {
    signatureConnectionRepository: new FirestoreSignatureConnectionRepository(),
    notificationRepository: new FirestoreNotificationRepository(),
    notificationFiltersRepository: new FirestoreNotificationFiltersRepository(),
  };
  return container;
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = null;
}
