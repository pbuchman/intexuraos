/**
 * Test services mock for code-agent tests.
 */

import { setServices, type ServiceContainer } from '../../services.js';
import { createFakeFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../infra/repositories/firestoreLogLineRepository.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok, err } from '@intexuraos/common-core';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createNoOpMetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import { createUserLookupService } from '../../infra/services/userLookupServiceImpl.js';
import { createGitHubUsernameResolver } from '../../infra/services/gitHubUsernameResolverImpl.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreGitHubPRSummariesRepository } from '../../infra/firestore/gitHubPRSummariesRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import type { WorkerHealthState } from '../../domain/models/workerSettings.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { createGitHubPRHttpClient } from '../../infra/http/gitHubPRHttpClient.js';
import { CodeWorkerOutputRule, RepositoryScopeRule, ActionableEventRule, ProtectedBaseBranchRule, SenderWhitelistRule, SkipPrefixRule, BotReviewEditRule, createWebhookRulesService } from '../../domain/services/gitHubWebhookRules.js';
import { createWebhookDispatchService } from '../../domain/services/gitHubDispatchService.js';
import { createWebhookMessageBuilder } from '../../domain/services/gitHubMessageBuilder.js';
import { ALLOWED_BOTS, CODE_WORKER_BOTS } from '../../routes/webhooks/github.js';
import { createFirestoreEventDecisionRepository } from '../../infra/firestore/eventDecisionRepository.js';
import { createFirestoreDispatchRetryRepository } from '../../infra/firestore/dispatchRetryRepository.js';
import { createUnifiedEvaluator } from '../../domain/services/unifiedEvaluator.js';
import type { AutomationLog } from '../../domain/ports/automationLog.js';
import { createTaskEnqueueService } from '../../infra/services/taskEnqueueServiceImpl.js';
import { createFirestoreMergeQueueWatchRepository } from '../../infra/firestore/mergeQueueWatchRepository.js';

/**
 * Mock UserServiceClient that returns empty results.
 * code-agent only uses getOAuthToken, so other methods are stubs.
 */
export const mockUserServiceClient: UserServiceClient = {
  async getApiKeys() {
    return ok({});
  },
  async getLlmClient() {
    return err({ code: 'NO_API_KEY', message: 'mock' }) as never;
  },
  async reportLlmSuccess() {
    return;
  },
  async getOAuthToken() {
    return err({ code: 'CONNECTION_NOT_FOUND', message: 'No OAuth connection' });
  },
  async resolveGitHubUsername() {
    return ok(null);
  },
};

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
  setFirestore(fakeFirestore);
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

  const webhookRules = createWebhookRulesService([
    new CodeWorkerOutputRule(CODE_WORKER_BOTS),
    new RepositoryScopeRule(new Set(['intexuraos/*'])),
    new ActionableEventRule(ALLOWED_BOTS),
    new ProtectedBaseBranchRule(),
    new SenderWhitelistRule(ALLOWED_BOTS),
    new SkipPrefixRule(['@claude', '@codex', '@ignore']),
    new BotReviewEditRule(ALLOWED_BOTS),
  ]);

  const automationLog: AutomationLog = {
    async record() {
      // No-op in tests
    },
  };

  const gitHubPREventRepo = createFirestoreGitHubPREventsRepository({ logger });

  const dispatchService = createWebhookDispatchService({
    gitHubPREventRepo,
    codeTaskRepo: createFirestoreCodeTaskRepository({ firestore: fakeFirestore, logger }),
    logLineRepo: createFirestoreLogLineRepository({ firestore: fakeFirestore, logger }),
    userLookupService: createUserLookupService({
      gitHubUsernameResolver: createGitHubUsernameResolver({ userServiceClient: mockUserServiceClient, logger }),
      workerSettingsRepo: createWorkerSettingsRepository({ firestore: fakeFirestore, logger }),
      logger,
    }),
    linearIssueService,
    taskDispatcher: createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe }),
    taskEnqueueService: createTaskEnqueueService({
      logger,
      codeTaskRepo: createFirestoreCodeTaskRepository({ firestore: fakeFirestore, logger }),
      whatsappNotifier: createWhatsAppNotifier({
        whatsappPublisher: { publishSendMessage: async () => ok(undefined) } as unknown as WhatsAppSendPublisher,
      }),
    }),
    whatsappNotifier: createWhatsAppNotifier({
      whatsappPublisher: { publishSendMessage: async () => ok(undefined) } as unknown as WhatsAppSendPublisher,
    }),
    workerSettingsRepo: createWorkerSettingsRepository({ firestore: fakeFirestore, logger }),
    statusMirrorService: createStatusMirrorService({ actionsAgentClient, logger }),
    gitHubPRClient: createGitHubPRHttpClient({ timeoutMs: 5000 }),
    userServiceClient: mockUserServiceClient,
    firestore: fakeFirestore,
    messageBuilder: createWebhookMessageBuilder(ALLOWED_BOTS, CODE_WORKER_BOTS),
    allowedBots: ALLOWED_BOTS,
    orchestratorSecret: 'test-secret',
    serviceUrl: 'http://localhost:8080',
    dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
    automationLog,
  });

  const eventDecisionRepo = createFirestoreEventDecisionRepository({ logger });

  const codeTaskRepo = createFirestoreCodeTaskRepository({
    firestore: fakeFirestore,
    logger,
  });

  const whatsappNotifier = createWhatsAppNotifier({
    whatsappPublisher: {
      publishSendMessage: async () => ok(undefined),
    } as unknown as WhatsAppSendPublisher,
  });

  const taskEnqueueService = createTaskEnqueueService({
    logger,
    codeTaskRepo,
    whatsappNotifier,
  });

  const container: ServiceContainer = {
    firestore: fakeFirestore,
    logger,
    codeTaskRepo,
    logChunkRepo: createFirestoreLogChunkRepository({
      firestore: fakeFirestore,
      logger,
    }),
    logLineRepo: createFirestoreLogLineRepository({
      firestore: fakeFirestore,
      logger,
    }),
    taskDispatcher: createTaskDispatcherService({
      logger,
      workerHealthProbe: mockWorkerHealthProbe,
    }),
    whatsappNotifier,
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
    userLookupService: createUserLookupService({
      gitHubUsernameResolver: createGitHubUsernameResolver({ userServiceClient: mockUserServiceClient, logger }),
      workerSettingsRepo: createWorkerSettingsRepository({
        firestore: fakeFirestore,
        logger,
      }),
      logger,
    }),
    workerHealthProbe: mockWorkerHealthProbe,
    gitHubPREventRepo,
    gitHubPRSummaryRepo: createFirestoreGitHubPRSummariesRepository({
      logger,
    }),
    turnMetricsRepo: createFirestoreTurnMetricsRepository({
      firestore: fakeFirestore,
      logger,
    }),
    userServiceClient: mockUserServiceClient,
    gitHubPRClient: createGitHubPRHttpClient({ timeoutMs: 5000 }),
    toolCallingClient: undefined,
    webhookRules: webhookRules,
    dispatchService: dispatchService,
    eventDecisionRepo: eventDecisionRepo,
    dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
    unifiedEvaluator: createUnifiedEvaluator({
      webhookRules,
      dispatchService,
      eventDecisionRepo,
      evaluateEvent: undefined,
      createReviewTask: async () => ({ ok: true as const, value: { status: 'created' as const, taskId: 'mock-task', workerType: 'qwen' } }),
      allowedBots: ALLOWED_BOTS,
      automationLog,
    }),
    automationLog,
    taskEnqueueService,
    mergeConflictDetector: {
      async detectOnPush() { /* no-op for tests */ },
      async reconcile() { return { processed: 0 }; },
    },
    mergeQueueWatchRepo: createFirestoreMergeQueueWatchRepository({ logger }),
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
