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
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createNoOpMetricsClient } from '../../infra/metrics.js';

export function setupTestServices({ actionsAgentUrl = 'http://actions-agent' }: { actionsAgentUrl?: string } = {}): void {
  const fakeFirestore = createFakeFirestore() as unknown as Firestore;
  const logger = pino({ name: 'test' });

  const rateLimitService: RateLimitService = {
    async checkLimits() {
      return ok(undefined);
    },
    async recordTaskStart() {
      return;
    },
    async recordTaskComplete() {
      return;
    },
  };

  const metricsClient = createNoOpMetricsClient();

  const linearAgentClient = createLinearAgentHttpClient({
    baseUrl: 'http://linear-agent:8086',
    internalAuthToken: 'test-token',
    timeoutMs: 10000,
  }, logger);

  const linearIssueService = createLinearIssueService({
    linearAgentClient,
    logger,
  });

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
      whatsappPublisher: {
        publishSendMessage: async () => ok(undefined),
      } as unknown as WhatsAppSendPublisher,
    }),
    actionsAgentClient,
    statusMirrorService: createStatusMirrorService({
      actionsAgentClient,
      logger,
    }),
    rateLimitService,
    linearIssueService,
    metricsClient,
    processHeartbeat: createProcessHeartbeatUseCase({
      codeTaskRepository: createFirestoreCodeTaskRepository({
        firestore: fakeFirestore,
        logger,
      }),
      logger,
    }),
    detectZombieTasks: createDetectZombieTasksUseCase({
      codeTaskRepository: createFirestoreCodeTaskRepository({
        firestore: fakeFirestore,
        logger,
      }),
      logger,
    }),
  };

  setServices(container);
}

export function resetTestServices(): void {
  // No-op - will be handled by resetServices()
}
