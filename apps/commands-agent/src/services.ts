import pino from 'pino';
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels } from '@intexuraos/llm-contract';
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
import { createGeminiClassifier } from './infra/llm/classifier.js';
import { createActionEventPublisher } from './infra/pubsub/index.js';
import { createUserServiceClient } from './infra/user/index.js';
import { adaptUserServiceClient, type UserServiceClient } from './domain/ports/userServiceClient.js';
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
  appSettingsServiceUrl: string;
  internalAuthToken: string;
  gcpProjectId: string;
}

let container: Services | null = null;

/**
 * Models supported for classification.
 */
const CLASSIFIER_MODELS = [
  LlmModels.Gemini25Flash,
  LlmModels.Glm47,
  LlmModels.Glm47Flash,
] as const;

export async function initServices(config: ServiceConfig): Promise<void> {
  const logger = pino({ name: 'commands-agent' });

  // Fetch pricing data from app-settings-service
  const pricingResult = await fetchAllPricing(
    config.appSettingsServiceUrl,
    config.internalAuthToken
  );

  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  const pricingContext = createPricingContext(pricingResult.value, [...CLASSIFIER_MODELS] as unknown as typeof LlmModels.Gemini25Flash[]);

  const commandRepository = createFirestoreCommandRepository();
  const actionsAgentClient = createActionsAgentClient({
    baseUrl: config.actionsAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: pino({ name: 'actionsAgentClient' }),
  });
  const classifierFactory: ClassifierFactory = (client, classifierLogger) =>
    createGeminiClassifier(client, classifierLogger);
  const sharedUserServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext,
    logger: pino({ name: 'userServiceClient' }),
  });
  const userServiceClient = adaptUserServiceClient(sharedUserServiceClient);
  const eventPublisher = createActionEventPublisher({
    projectId: config.gcpProjectId,
    logger: pino({ name: 'action-event-publisher' }),
  });

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
