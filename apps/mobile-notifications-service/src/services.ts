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
import { FirestoreBackfillRunRepository } from './infra/firestore/firestoreBackfillRunRepository.js';

export interface ServiceContainer {
  signatureConnectionRepository: SignatureConnectionRepository;
  notificationRepository: NotificationRepository;
  notificationFiltersRepository: NotificationFiltersRepository;
  digestRepository: DigestRepository;
  groupStateRepository: GroupStateRepository;
  digestLockRepository: DigestLockRepository;
  backfillRunRepository: FirestoreBackfillRunRepository;
}

let container: ServiceContainer | null = null;

export function getServices(): ServiceContainer {
  container ??= {
    signatureConnectionRepository: new FirestoreSignatureConnectionRepository(),
    notificationRepository: new FirestoreNotificationRepository(),
    notificationFiltersRepository: new FirestoreNotificationFiltersRepository(),
    digestRepository: new FirestoreDigestRepository(),
    groupStateRepository: new FirestoreGroupStateRepository(),
    digestLockRepository: new FirestoreDigestLockRepository(),
    backfillRunRepository: new FirestoreBackfillRunRepository(),
  };
  return container;
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = null;
}
