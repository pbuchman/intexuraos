/**
 * Test services mock for code-agent tests.
 */

import { setServices, type ServiceContainer } from '../../services.js';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
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
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createNoOpMetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestorePRTaskLockRepository } from '../../infra/firestore/firestorePRTaskLockRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import type { WorkerHealthState } from '../../domain/models/workerSettings.js';

/**
 * Mock worker health probe that always returns healthy status.
 */
export const mockWorkerHealthProbe: WorkerHealthProbe = {
  async probeWorker() {
    return {
      _tag: 'healthy',
      healthy: true,
      capacity: 1,
      running: 0,
      available: 1,
      responseTimeMs: 50,
    };
  },
  async probeAllWorkers(workers) {
    const results: Record<string, WorkerHealthState> = {};
    for (const worker of workers) {
      results[worker.name] = await mockWorkerHealthProbe.probeWorker(worker);
    }
    return results;
  },
};

export function setupTestServices({ actionsAgentUrl = 'http://actions-agent' }: { actionsAgentUrl?: string } = {}): void {
  const fakeFirestore = createFakeFirestore() as unknown as Firestore;
  const logger = pino({ name: 'test', level: 'silent' });

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
    taskDispatcher: createTaskDispatcherService({
      logger,
    }),
    whatsappNotifier: createWhatsAppNotifier({
      whatsappPublisher: {
        publishSendMessage: async () => ok(undefined),
      } as unknown as WhatsAppSendPublisher,
    }),
    actionsAgentClient,
    linearAgentClient,
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
    cleanupTaskLogs: createCleanupTaskLogsUseCase({
      codeTaskRepository: createFirestoreCodeTaskRepository({
        firestore: fakeFirestore,
        logger,
      }),
      logger,
    }),
    workerSettingsRepo: createWorkerSettingsRepository({
      firestore: fakeFirestore,
      logger,
    }),
    workerHealthProbe: mockWorkerHealthProbe,
    gitHubPREventRepo: createFirestoreGitHubPREventsRepository({
      logger,
    }),
    prTaskLockRepo: createFirestorePRTaskLockRepository({
      firestore: fakeFirestore,
      logger,
    }),
  };

  setServices(container);
}

export function resetTestServices(): void {
  // No-op - will be handled by resetServices()
}

/**
 * Set up default worker settings for a test user.
 * Call this in tests that need to dispatch tasks.
 */
export async function setupTestWorkerSettings(userId: string): Promise<void> {
  const { getServices } = await import('../../services.js');
  const { workerSettingsRepo } = getServices();

  // Add a default worker for testing
  await workerSettingsRepo.addWorker(userId, {
    name: 'home-mac',
    url: 'https://cc-mac.intexuraos.cloud',
    cfAccessClientId: 'test-client-id',
    cfAccessClientSecret: 'test-client-secret',
    dispatchSigningSecret: 'test-dispatch-secret',
  });
}
