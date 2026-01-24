/**
 * Test services mock for code-agent tests.
 */

import { setServices, type ServiceContainer } from '../../services.js';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';

export function setupTestServices(): void {
  const fakeFirestore = createFakeFirestore() as unknown as Firestore;
  const logger = pino({ name: 'test' });

  const container: ServiceContainer = {
    firestore: fakeFirestore,
    logger,
    codeTaskRepo: createFirestoreCodeTaskRepository({
      firestore: fakeFirestore,
      logger,
    }),
  };

  setServices(container);
}

export function resetTestServices(): void {
  // No-op - will be handled by resetServices()
}
