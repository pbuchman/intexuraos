import pino from 'pino';
import type { TodoRepository } from './domain/ports/todoRepository.js';
import { FirestoreTodoRepository } from './infra/firestore/firestoreTodoRepository.js';
import {
  createTodosProcessingPublisher,
  type TodosProcessingPublisher,
} from '@intexuraos/infra-pubsub';
import { createUserServiceClient, type UserServiceClient } from './infra/user/userServiceClient.js';
import { createTodoItemExtractionService, type TodoItemExtractionService } from './infra/gemini/todoItemExtractionService.js';
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';

export interface ServiceContainer {
  todoRepository: TodoRepository;
  todosProcessingPublisher: TodosProcessingPublisher;
  userServiceClient: UserServiceClient;
  todoItemExtractionService: TodoItemExtractionService;
}

export interface ServiceConfig {
  gcpProjectId: string;
  todosProcessingTopic: string;
  internalAuthKey: string;
  userServiceUrl: string;
  appSettingsServiceUrl: string;
}

let container: ServiceContainer | null = null;

export async function initServices(config: ServiceConfig): Promise<void> {
  const pricingResult = await fetchAllPricing(
    config.appSettingsServiceUrl,
    config.internalAuthKey
  );

  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  // Support both Gemini and GLM for todo extraction
  const pricingContext = createPricingContext(pricingResult.value, [
    LlmModels.Gemini25Flash,
    LlmModels.Glm47,
  ] as FastModel[]);

  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthKey,
    pricingContext,
  });

  container = {
    todoRepository: new FirestoreTodoRepository(),
    todosProcessingPublisher: createTodosProcessingPublisher({
      projectId: config.gcpProjectId,
      topicName: config.todosProcessingTopic,
    }),
    userServiceClient,
    todoItemExtractionService: createTodoItemExtractionService(
      userServiceClient,
      pino({ name: 'todoItemExtractionService' })
    ),
  };
}

export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(s: ServiceContainer): void {
  container = s;
}

export function resetServices(): void {
  container = null;
}
