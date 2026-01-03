import type { ActionServiceClient } from './domain/ports/actionServiceClient.js';
import type { ResearchServiceClient } from './domain/ports/researchServiceClient.js';
import type { NotificationSender } from './domain/ports/notificationSender.js';
import type { ActionRepository } from './domain/ports/actionRepository.js';
import {
  createHandleResearchActionUseCase,
  type HandleResearchActionUseCase,
} from './domain/usecases/handleResearchAction.js';
import {
  createExecuteResearchActionUseCase,
  type ExecuteResearchActionUseCase,
} from './domain/usecases/executeResearchAction.js';
import {
  createRetryPendingActionsUseCase,
  type RetryPendingActionsUseCase,
} from './domain/usecases/retryPendingActions.js';
import pino from 'pino';
import { createLocalActionServiceClient } from './infra/action/localActionServiceClient.js';
import { createLlmOrchestratorClient } from './infra/research/llmOrchestratorClient.js';
import { createWhatsappNotificationSender } from './infra/notification/whatsappNotificationSender.js';
import { createFirestoreActionRepository } from './infra/firestore/actionRepository.js';
import { createActionEventPublisher, type ActionEventPublisher } from './infra/pubsub/index.js';
import { createWhatsAppSendPublisher, type WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';

export interface Services {
  actionServiceClient: ActionServiceClient;
  researchServiceClient: ResearchServiceClient;
  notificationSender: NotificationSender;
  actionRepository: ActionRepository;
  actionEventPublisher: ActionEventPublisher;
  whatsappPublisher: WhatsAppSendPublisher;
  handleResearchActionUseCase: HandleResearchActionUseCase;
  executeResearchActionUseCase: ExecuteResearchActionUseCase;
  retryPendingActionsUseCase: RetryPendingActionsUseCase;
  // Action handler registry (for dynamic routing)
  research: HandleResearchActionUseCase;
}

export interface ServiceConfig {
  llmOrchestratorUrl: string;
  userServiceUrl: string;
  internalAuthToken: string;
  gcpProjectId: string;
  whatsappSendTopic: string;
  webAppUrl: string;
}

let container: Services | null = null;

export function initServices(config: ServiceConfig): void {
  const actionRepository = createFirestoreActionRepository();
  const actionServiceClient = createLocalActionServiceClient(actionRepository);

  const researchServiceClient = createLlmOrchestratorClient({
    baseUrl: config.llmOrchestratorUrl,
    internalAuthToken: config.internalAuthToken,
  });

  const notificationSender = createWhatsappNotificationSender({
    userServiceUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
  });

  const actionEventPublisher = createActionEventPublisher({
    projectId: config.gcpProjectId,
  });

  const whatsappPublisher = createWhatsAppSendPublisher({
    projectId: config.gcpProjectId,
    topicName: config.whatsappSendTopic,
  });

  const handleResearchActionUseCase = createHandleResearchActionUseCase({
    actionServiceClient,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
  });

  const executeResearchActionUseCase = createExecuteResearchActionUseCase({
    actionRepository,
    researchServiceClient,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
  });

  const retryPendingActionsUseCase = createRetryPendingActionsUseCase({
    actionRepository,
    actionEventPublisher,
    actionHandlerRegistry: { research: handleResearchActionUseCase },
    logger: pino({ name: 'retryPendingActions' }),
  });

  container = {
    actionServiceClient,
    researchServiceClient,
    notificationSender,
    actionRepository,
    actionEventPublisher,
    whatsappPublisher,
    handleResearchActionUseCase,
    executeResearchActionUseCase,
    retryPendingActionsUseCase,
    // Action handler registry (for dynamic routing)
    research: handleResearchActionUseCase,
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
