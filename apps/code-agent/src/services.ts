/**
 * Service wiring for code-agent.
 * Provides dependency injection for domain adapters.
 */

import pino from 'pino';
import type { Firestore } from '@google-cloud/firestore';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { CodeWorkersConfig } from './config.js';
import type { CodeTaskRepository } from './domain/repositories/codeTaskRepository.js';
import type { LogChunkRepository } from './domain/repositories/logChunkRepository.js';
import type { WorkerDiscoveryService } from './domain/services/workerDiscovery.js';
import type { TaskDispatcherService } from './domain/services/taskDispatcher.js';
import type { ActionsAgentClient } from './infra/clients/actionsAgentClient.js';
import { createFirestoreCodeTaskRepository } from './infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from './infra/repositories/firestoreLogChunkRepository.js';
import { createWorkerDiscoveryService } from './infra/services/workerDiscoveryImpl.js';
import { createTaskDispatcherService } from './infra/services/taskDispatcherImpl.js';
import { createActionsAgentClient } from './infra/clients/actionsAgentClient.js';

export interface ServiceContainer {
  firestore: Firestore;
  logger: pino.Logger;
  codeTaskRepo: CodeTaskRepository;
  logChunkRepo: LogChunkRepository;
  workerDiscovery: WorkerDiscoveryService;
  taskDispatcher: TaskDispatcherService;
  actionsAgentClient: ActionsAgentClient;
}

// Configuration required to initialize services
export interface ServiceConfig {
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  linearAgentUrl: string;
  actionsAgentUrl: string;
  dispatchSecret: string;
  webhookVerifySecret: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  codeWorkers: CodeWorkersConfig;
}

let container: ServiceContainer | null = null;

/**
 * Initialize services with config. Call this early in server startup.
 * MUST be called before getServices().
 */
export function initServices(config: ServiceConfig): void {
  const firestore = getFirestore();
  const logger = pino({ name: 'code-agent' });

  container = {
    firestore,
    logger,
    codeTaskRepo: createFirestoreCodeTaskRepository({ firestore, logger }),
    logChunkRepo: createFirestoreLogChunkRepository({ firestore, logger }),
    workerDiscovery: createWorkerDiscoveryService({ logger }),
    taskDispatcher: createTaskDispatcherService({ logger }),
    actionsAgentClient: createActionsAgentClient({
      baseUrl: config.actionsAgentUrl,
      internalAuthToken: config.internalAuthToken,
      logger,
    }),
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
