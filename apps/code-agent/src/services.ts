/**
 * Service wiring for code-agent.
 * Provides dependency injection for domain adapters.
 */

import pino from 'pino';
import type { Firestore } from '@google-cloud/firestore';
import { ok } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import { createWhatsAppSendPublisher, type WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { CodeTaskRepository } from './domain/repositories/codeTaskRepository.js';
import type { LogChunkRepository } from './domain/repositories/logChunkRepository.js';
import type { WorkerDiscoveryService } from './domain/services/workerDiscovery.js';
import type { TaskDispatcherService } from './domain/services/taskDispatcher.js';
import type { WhatsAppNotifier } from './domain/services/whatsappNotifier.js';
import type { ActionsAgentClient } from './infra/clients/actionsAgentClient.js';
import type { RateLimitService } from './domain/services/rateLimitService.js';
import { createFirestoreCodeTaskRepository } from './infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from './infra/repositories/firestoreLogChunkRepository.js';
import { createWorkerDiscoveryService } from './infra/services/workerDiscoveryImpl.js';
import { createTaskDispatcherService } from './infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from './infra/services/whatsappNotifierImpl.js';
import { createActionsAgentClient } from './infra/clients/actionsAgentClient.js';
import { createUserUsageFirestoreRepository } from './infra/firestore/userUsageFirestoreRepository.js';
import { createRateLimitService } from './domain/services/rateLimitService.js';
import { createLinearAgentHttpClient } from './infra/http/linearAgentHttpClient.js';
import { createLinearIssueService, type LinearIssueService } from './domain/services/linearIssueService.js';
import { createStatusMirrorService, type StatusMirrorService } from './infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase, type ProcessHeartbeatUseCase } from './domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase, type DetectZombieTasksUseCase } from './domain/usecases/detectZombieTasks.js';
import { createMetricsClient, createNoOpMetricsClient, type MetricsClient } from './infra/metrics.js';
import type { LinearAgentClient } from './domain/ports/linearAgentClient.js';

export interface ServiceContainer {
  firestore: Firestore;
  logger: pino.Logger;
  codeTaskRepo: CodeTaskRepository;
  logChunkRepo: LogChunkRepository;
  workerDiscovery: WorkerDiscoveryService;
  taskDispatcher: TaskDispatcherService;
  whatsappNotifier: WhatsAppNotifier;
  actionsAgentClient: ActionsAgentClient;
  rateLimitService: RateLimitService;
  linearIssueService: LinearIssueService;
  statusMirrorService: StatusMirrorService;
  processHeartbeat: ProcessHeartbeatUseCase;
  detectZombieTasks: DetectZombieTasksUseCase;
  metricsClient: MetricsClient;
}

// Configuration required to initialize services
export interface ServiceConfig {
  gcpProjectId: string;
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  whatsappSendTopic: string;
  linearAgentUrl: string;
  actionsAgentUrl: string;
  dispatchSigningSecret: string;
  webhookVerifySecret: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  orchestratorMacUrl: string;
  orchestratorVmUrl: string;
}

let container: ServiceContainer | null = null;

const isE2eMode = process.env['E2E_MODE'] === 'true';

/**
 * Create a no-op WhatsApp publisher for E2E testing.
 */
function createE2eWhatsAppPublisher(): WhatsAppSendPublisher {
  return {
    publishSendMessage(): ReturnType<WhatsAppSendPublisher['publishSendMessage']> {
      return Promise.resolve(ok(undefined));
    },
  };
}

/**
 * Create a no-op Linear agent client for E2E testing.
 */
function createE2eLinearAgentClient(logger: pino.Logger): LinearAgentClient {
  return {
    createIssue(request): ReturnType<LinearAgentClient['createIssue']> {
      logger.info({ title: request.title }, '[E2E] Mock Linear issue creation');
      return Promise.resolve(ok({
        issueId: `e2e-issue-${String(Date.now())}`,
        issueIdentifier: 'INT-E2E',
        issueTitle: request.title,
        issueUrl: 'https://linear.app/e2e-test-issue',
      }));
    },
    updateIssueState(request): ReturnType<LinearAgentClient['updateIssueState']> {
      logger.info({ issueId: request.issueId, state: request.state }, '[E2E] Mock Linear state update');
      return Promise.resolve(ok(undefined));
    },
  };
}

/**
 * Create a no-op actions agent client for E2E testing.
 */
function createE2eActionsAgentClient(logger: pino.Logger): ActionsAgentClient {
  return {
    updateActionStatus(actionId, status): ReturnType<ActionsAgentClient['updateActionStatus']> {
      logger.info({ actionId, status }, '[E2E] Mock action status update');
      return Promise.resolve(ok(undefined));
    },
  };
}

/**
 * Initialize services with config. Call this early in server startup.
 * MUST be called before getServices().
 */
export function initServices(config: ServiceConfig): void {
  const firestore = getFirestore();
  const logger = pino({ name: 'code-agent' });

  if (isE2eMode) {
    logger.info('Initializing services in E2E mode with mock external services');
  }

  const linearAgentClient = isE2eMode
    ? createE2eLinearAgentClient(logger)
    : createLinearAgentHttpClient({
        baseUrl: config.linearAgentUrl,
        internalAuthToken: config.internalAuthToken,
        timeoutMs: 10000,
      }, logger);

  const linearIssueService = createLinearIssueService({
    linearAgentClient,
    logger,
  });

  const actionsAgentClient = isE2eMode
    ? createE2eActionsAgentClient(logger)
    : createActionsAgentClient({
        baseUrl: config.actionsAgentUrl,
        internalAuthToken: config.internalAuthToken,
        logger,
      });

  const metricsClient = isE2eMode ? createNoOpMetricsClient() : createMetricsClient();

  const whatsappPublisher = isE2eMode
    ? createE2eWhatsAppPublisher()
    : createWhatsAppSendPublisher({
        projectId: config.gcpProjectId,
        topicName: config.whatsappSendTopic,
        logger: pino({ name: 'whatsapp-publisher' }),
      });

  container = {
    firestore,
    logger,
    codeTaskRepo: createFirestoreCodeTaskRepository({ firestore, logger }),
    logChunkRepo: createFirestoreLogChunkRepository({ firestore, logger }),
    workerDiscovery: createWorkerDiscoveryService({ logger }),
    taskDispatcher: createTaskDispatcherService({
      logger,
      cfAccessClientId: config.cfAccessClientId,
      cfAccessClientSecret: config.cfAccessClientSecret,
      dispatchSigningSecret: config.dispatchSigningSecret,
      orchestratorMacUrl: config.orchestratorMacUrl,
      orchestratorVmUrl: config.orchestratorVmUrl,
    }),
    whatsappNotifier: createWhatsAppNotifier({
      whatsappPublisher,
    }),
    actionsAgentClient,
    statusMirrorService: createStatusMirrorService({
      actionsAgentClient,
      logger,
    }),
    rateLimitService: createRateLimitService({
      userUsageRepository: createUserUsageFirestoreRepository(firestore, logger),
      logger,
    }),
    linearIssueService,
    processHeartbeat: createProcessHeartbeatUseCase({
      codeTaskRepository: createFirestoreCodeTaskRepository({ firestore, logger }),
      logger,
    }),
    detectZombieTasks: createDetectZombieTasksUseCase({
      codeTaskRepository: createFirestoreCodeTaskRepository({ firestore, logger }),
      logger,
    }),
    metricsClient,
  };
}


/**
 * Get the service container. Throws if initServices() wasn't called.
 * DO NOT add fallbacks here - that creates test code in production.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

/**
 * Replace services for testing. Only use in tests.
 */
export function setServices(s: ServiceContainer): void {
  container = s;
}

/**
 * Reset services. Call in afterEach() in tests.
 */
export function resetServices(): void {
  container = null;
}
