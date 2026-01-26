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
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';

export function setupTestServices({ actionsAgentUrl = 'http://actions-agent' }: { actionsAgentUrl?: string } = {}): void {
  const fakeFirestore = createFakeFirestore() as unknown as Firestore;
  const logger = pino({ name: 'test' });

  const actionsAgentClient = createActionsAgentClient({
    baseUrl: actionsAgentUrl,
    internalAuthToken: 'test-token',
    logger,
  });

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
    taskDispatcher: createTaskDispatcherService({
      logger,
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
      orchestratorMacUrl: 'https://cc-mac.intexuraos.cloud',
      orchestratorVmUrl: 'https://cc-vm.intexuraos.cloud',
    }),
    whatsappNotifier: createWhatsAppNotifier({
      baseUrl: 'http://whatsapp-service',
      internalAuthToken: 'test-token',
      logger,
    }),
    actionsAgentClient,
    statusMirrorService: createStatusMirrorService({
      actionsAgentClient,
      logger,
    }),
  };

  setServices(container);
}

export function resetTestServices(): void {
  // No-op - will be handled by resetServices()
}
