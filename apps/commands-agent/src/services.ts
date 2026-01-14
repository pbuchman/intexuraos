import pino from 'pino';
import type { ModelPricing } from '@intexuraos/llm-contract';
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
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';

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
  appSettingsServiceUrl: string;
}

let container: Services | null = null;

/**
 * Pricing for gemini-2.5-flash used by the classifier.
 * Values from migration 012 pricing structure.
 */
const CLASSIFIER_PRICING: ModelPricing = {
  inputPricePerMillion: 0.3,
  outputPricePerMillion: 2.5,
  groundingCostPerRequest: 0.035,
};

export async function initServices(config: ServiceConfig): Promise<void> {
  const logger = pino({ name: 'commands-agent' });

  const pricingResult = await fetchAllPricing(
    config.appSettingsServiceUrl,
    config.internalAuthToken
  );

  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  // Support all fast models for command processing
  const pricingContext = createPricingContext(pricingResult.value, [
    LlmModels.Gemini25Flash,
    LlmModels.Glm47,
  ] as FastModel[]);

  const commandRepository = createFirestoreCommandRepository();
  const actionsAgentClient = createActionsAgentClient({
    baseUrl: config.actionsAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: pino({ name: 'actionsAgentClient' }),
  });
  const classifierFactory: ClassifierFactory = (apiKey: string, userId: string) =>
    createGeminiClassifier({ apiKey, userId, pricing: CLASSIFIER_PRICING });
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext,
    logger: pino({ name: 'userServiceClient' }),
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
