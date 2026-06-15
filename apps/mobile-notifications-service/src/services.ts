import type {
  NotificationRepository,
  SignatureConnectionRepository,
} from './domain/notifications/index.js';
import type { NotificationFiltersRepository } from './domain/filters/index.js';
import type {
  BackfillRunRepository,
  DigestRepository,
  GroupStateRepository,
  DigestLockRepository,
} from './domain/repositories/digestRepositories.js';
import type { DigestSubscription } from './domain/digestSubscriptions.js';
import { DIGEST_SUBSCRIPTIONS } from './domain/digestSubscriptions.js';
import { FirestoreSignatureConnectionRepository } from './infra/firestore/firestoreSignatureConnectionRepository.js';
import { FirestoreNotificationRepository } from './infra/firestore/firestoreNotificationRepository.js';
import { FirestoreNotificationFiltersRepository } from './infra/firestore/notificationFiltersRepository.js';
import { FirestoreDigestRepository } from './infra/firestore/firestoreDigestRepository.js';
import { FirestoreGroupStateRepository } from './infra/firestore/firestoreGroupStateRepository.js';
import { FirestoreDigestLockRepository } from './infra/firestore/firestoreDigestLockRepository.js';
import { FirestoreBackfillRunRepository } from './infra/firestore/firestoreBackfillRunRepository.js';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { createWhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
import type { DigestNotifier } from './domain/services/digestNotifier.js';
import { NoopDigestNotifier } from './domain/services/digestNotifier.js';
import { WhatsAppDigestNotifier } from './infra/notification/index.js';

export interface ServiceContainer {
  signatureConnectionRepository: SignatureConnectionRepository;
  notificationRepository: NotificationRepository;
  notificationFiltersRepository: NotificationFiltersRepository;
  digestRepository: DigestRepository;
  groupStateRepository: GroupStateRepository;
  digestLockRepository: DigestLockRepository;
  backfillRunRepository: BackfillRunRepository;
  digestSubscriptions: readonly DigestSubscription[];
  digestNotifier: DigestNotifier;
}

let container: ServiceContainer | null = null;

function createDigestNotifier(): DigestNotifier {
  const projectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
  const topicName = process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'];
  const webAppUrl = process.env['INTEXURAOS_WEB_APP_URL'];
  if (
    projectId === undefined || projectId === '' ||
    topicName === undefined || topicName === '' ||
    webAppUrl === undefined || webAppUrl === ''
  ) {
    return new NoopDigestNotifier();
  }
  const logger = createAppLogger({ name: 'whatsapp-digest-notifier' });
  const publisher = createWhatsAppSendPublisher({ projectId, topicName, logger });
  return new WhatsAppDigestNotifier({ publisher, webAppUrl, logger });
}

export function getServices(): ServiceContainer {
  container ??= {
    signatureConnectionRepository: new FirestoreSignatureConnectionRepository(),
    notificationRepository: new FirestoreNotificationRepository(),
    notificationFiltersRepository: new FirestoreNotificationFiltersRepository(),
    digestRepository: new FirestoreDigestRepository(),
    groupStateRepository: new FirestoreGroupStateRepository(),
    digestLockRepository: new FirestoreDigestLockRepository(),
    backfillRunRepository: new FirestoreBackfillRunRepository(),
    digestSubscriptions: DIGEST_SUBSCRIPTIONS,
    digestNotifier: createDigestNotifier(),
  };
  return container;
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = null;
}
