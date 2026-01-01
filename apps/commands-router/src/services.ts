import pino from 'pino';
import type { CommandRepository } from './domain/ports/commandRepository.js';
import type { ActionRepository } from './domain/ports/actionRepository.js';
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
import { createFirestoreActionRepository } from './infra/firestore/actionRepository.js';
import { createGeminiClassifier } from './infra/gemini/classifier.js';
import { createActionEventPublisher } from './infra/pubsub/index.js';
import { createUserServiceClient, type UserServiceClient } from './infra/user/index.js';

export interface Services {
  commandRepository: CommandRepository;
  actionRepository: ActionRepository;
  classifierFactory: ClassifierFactory;
  userServiceClient: UserServiceClient;
  eventPublisher: EventPublisherPort;
  processCommandUseCase: ProcessCommandUseCase;
  retryPendingCommandsUseCase: RetryPendingCommandsUseCase;
}

export interface ServiceConfig {
  userServiceUrl: string;
  internalAuthToken: string;
  gcpProjectId: string;
}

let container: Services | null = null;

export function initServices(config: ServiceConfig): void {
  const logger = pino({ name: 'commands-router' });

  const commandRepository = createFirestoreCommandRepository();
  const actionRepository = createFirestoreActionRepository();
  const classifierFactory: ClassifierFactory = (apiKey: string) =>
    createGeminiClassifier({ apiKey });
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
  });
  const eventPublisher = createActionEventPublisher({ projectId: config.gcpProjectId });

  container = {
    commandRepository,
    actionRepository,
    classifierFactory,
    userServiceClient,
    eventPublisher,
    processCommandUseCase: createProcessCommandUseCase({
      commandRepository,
      actionRepository,
      classifierFactory,
      userServiceClient,
      eventPublisher,
      logger,
    }),
    retryPendingCommandsUseCase: createRetryPendingCommandsUseCase({
      commandRepository,
      actionRepository,
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
