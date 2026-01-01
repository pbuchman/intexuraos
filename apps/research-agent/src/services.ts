import type { ActionServiceClient } from './domain/ports/actionServiceClient.js';
import type { ResearchServiceClient } from './domain/ports/researchServiceClient.js';
import type { NotificationSender } from './domain/ports/notificationSender.js';
import {
  createHandleResearchActionUseCase,
  type HandleResearchActionUseCase,
} from './domain/usecases/handleResearchAction.js';
import { createCommandsRouterClient } from './infra/action/commandsRouterClient.js';
import { createLlmOrchestratorClient } from './infra/research/llmOrchestratorClient.js';
import { createWhatsappNotificationSender } from './infra/notification/whatsappNotificationSender.js';

export interface Services {
  actionServiceClient: ActionServiceClient;
  researchServiceClient: ResearchServiceClient;
  notificationSender: NotificationSender;
  handleResearchActionUseCase: HandleResearchActionUseCase;
}

export interface ServiceConfig {
  commandsRouterUrl: string;
  llmOrchestratorUrl: string;
  userServiceUrl: string;
  internalAuthToken: string;
}

let container: Services | null = null;

export function initServices(config: ServiceConfig): void {
  const actionServiceClient = createCommandsRouterClient({
    baseUrl: config.commandsRouterUrl,
    internalAuthToken: config.internalAuthToken,
  });

  const researchServiceClient = createLlmOrchestratorClient({
    baseUrl: config.llmOrchestratorUrl,
    internalAuthToken: config.internalAuthToken,
  });

  const notificationSender = createWhatsappNotificationSender({
    userServiceUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
  });

  container = {
    actionServiceClient,
    researchServiceClient,
    notificationSender,
    handleResearchActionUseCase: createHandleResearchActionUseCase({
      actionServiceClient,
      researchServiceClient,
      notificationSender,
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
