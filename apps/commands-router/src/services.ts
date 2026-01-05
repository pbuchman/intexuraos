import pino from 'pino';
import type { CommandRepository } from './domain/ports/commandRepository.js';
import type { ClassifierFactory } from './domain/ports/classifier.js';
import type { EventPublisherPort } from './domain/ports/eventPublisher.js';
import {
  createProcessCommandUseCase,
  type ProcessCommandUseCase,
} from './domain/usecases/processCommand.js';
import {
  createRetryPendingCommandsUseCase,
  type RetryPendingCommandsUseCase,
} from './domain/usecases/retryPendingCommands.js';
import { createFirestoreCommandRepository } from './infra/firestore/commandRepository.js';
import { createGeminiClassifier } from './infra/gemini/classifier.js';
import { createActionEventPublisher } from './infra/pubsub/index.js';
import { createUserServiceClient, type UserServiceClient } from './infra/user/index.js';
import { createActionsAgentClient, type ActionsAgentClient } from './infra/actionsAgent/client.js';

export interface Services {
  commandRepository: CommandRepository;
  actionsAgentClient: ActionsAgentClient;
  classifierFactory: ClassifierFactory;
  userServiceClient: UserServiceClient;
  eventPublisher: EventPublisherPort;
  processCommandUseCase: ProcessCommandUseCase;
  retryPendingCommandsUseCase: RetryPendingCommandsUseCase;
}

export interface ServiceConfig {
  userServiceUrl: string;
  actionsAgentUrl: string;
  internalAuthToken: string;
  gcpProjectId: string;
}

let container: Services | null = null;

export function initServices(config: ServiceConfig): void {
  const logger = pino({ name: 'commands-router' });

  const commandRepository = createFirestoreCommandRepository();
  const actionsAgentClient = createActionsAgentClient({
    baseUrl: config.actionsAgentUrl,
    internalAuthToken: config.internalAuthToken,
  });
  const classifierFactory: ClassifierFactory = (apiKey: string, userId: string) =>
    createGeminiClassifier({ apiKey, userId });
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
  });
  const eventPublisher = createActionEventPublisher({ projectId: config.gcpProjectId });

  container = {
    commandRepository,
    actionsAgentClient,
    classifierFactory,
    userServiceClient,
    eventPublisher,
    processCommandUseCase: createProcessCommandUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory,
      userServiceClient,
      eventPublisher,
      logger,
    }),
    retryPendingCommandsUseCase: createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory,
      userServiceClient,
      eventPublisher,
      logger,
    }),
  };
}

export function getServices(): Services {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(s: Services): void {
  container = s;
}

export function resetServices(): void {
  container = null;
}
