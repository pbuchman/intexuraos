/**
 * Test services mock for code-agent tests.
 */

import { setServices, type ServiceContainer } from '../../services.js';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createWorkerDiscoveryService } from '../../infra/services/workerDiscoveryImpl.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';

export function setupTestServices({ actionsAgentUrl = 'http://actions-agent' }: { actionsAgentUrl?: string } = {}): void {
  // Set required env vars for worker discovery
  process.env['INTEXURAOS_CODE_WORKERS'] =
    'mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2';
  process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
  process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
  process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';

  const fakeFirestore = createFakeFirestore() as unknown as Firestore;
  const logger = pino({ name: 'test' });

  const container: ServiceContainer = {
    firestore: fakeFirestore,
    logger,
    codeTaskRepo: createFirestoreCodeTaskRepository({
      firestore: fakeFirestore,
      logger,
    }),
    logChunkRepo: createFirestoreLogChunkRepository({
      firestore: fakeFirestore,
      logger,
    }),
    workerDiscovery: createWorkerDiscoveryService({ logger }),
    taskDispatcher: createTaskDispatcherService({ logger }),
    whatsappNotifier: createWhatsAppNotifier({
      baseUrl: 'http://whatsapp-service',
      internalAuthToken: 'test-token',
      logger,
    }),
    actionsAgentClient: createActionsAgentClient({
      baseUrl: actionsAgentUrl,
      internalAuthToken: 'test-token',
      logger,
    }),
  };

  setServices(container);
}

export function resetTestServices(): void {
  // No-op - will be handled by resetServices()
}
