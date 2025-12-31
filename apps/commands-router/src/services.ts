import type { CommandRepository } from './domain/ports/commandRepository.js';
import type { ActionRepository } from './domain/ports/actionRepository.js';
import type { ClassifierFactory } from './domain/ports/classifier.js';
import {
  createProcessCommandUseCase,
  type ProcessCommandUseCase,
} from './domain/usecases/processCommand.js';
import { createFirestoreCommandRepository } from './infra/firestore/commandRepository.js';
import { createFirestoreActionRepository } from './infra/firestore/actionRepository.js';
import { createGeminiClassifier } from './infra/gemini/classifier.js';
import { createUserServiceClient, type UserServiceClient } from './infra/user/index.js';

export interface Services {
  commandRepository: CommandRepository;
  actionRepository: ActionRepository;
  classifierFactory: ClassifierFactory;
  userServiceClient: UserServiceClient;
  processCommandUseCase: ProcessCommandUseCase;
}

export interface ServiceConfig {
  userServiceUrl: string;
  internalAuthToken: string;
}

let container: Services | null = null;

export function initServices(config: ServiceConfig): void {
  const commandRepository = createFirestoreCommandRepository();
  const actionRepository = createFirestoreActionRepository();
  const classifierFactory: ClassifierFactory = (apiKey: string) =>
    createGeminiClassifier({ apiKey });
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
  });

  container = {
    commandRepository,
    actionRepository,
    classifierFactory,
    userServiceClient,
    processCommandUseCase: createProcessCommandUseCase({
      commandRepository,
      actionRepository,
      classifierFactory,
      userServiceClient,
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
