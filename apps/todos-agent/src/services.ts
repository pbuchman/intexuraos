import { createAppLogger } from '@intexuraos/infra-sentry';
import type { TodoRepository } from './domain/ports/todoRepository.js';
import { FirestoreTodoRepository } from './infra/firestore/firestoreTodoRepository.js';
import {
  createTodosProcessingPublisher,
  type TodosProcessingPublisher,
} from '@intexuraos/infra-pubsub';
import { createUserServiceClient, type UserServiceClient } from '@intexuraos/internal-clients';
import { createTodoItemExtractionService, type TodoItemExtractionService } from './infra/gemini/todoItemExtractionService.js';
import {
  fetchAllPricingWithRetry,
  HttpInternalAuthUsageSink,
} from '@intexuraos/llm-pricing';

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
  llmUsageServiceUrl: string;
}

let container: ServiceContainer | null = null;

export async function initServices(config: ServiceConfig): Promise<void> {
  const pricingResult = await fetchAllPricingWithRetry(
    config.llmUsageServiceUrl,
    config.internalAuthKey
  );

  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  const userServiceClientLogger = createAppLogger({ name: 'userServiceClient' });
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthKey,
    logger: userServiceClientLogger,
    usageSink: new HttpInternalAuthUsageSink({
      usageServiceUrl: config.llmUsageServiceUrl,
      internalAuthToken: config.internalAuthKey,
      service: 'todos-agent',
      component: 'user-service-client',
      logger: userServiceClientLogger,
    }),
    platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
  });

  container = {
    todoRepository: new FirestoreTodoRepository(),
    todosProcessingPublisher: createTodosProcessingPublisher({
      projectId: config.gcpProjectId,
      topicName: config.todosProcessingTopic,
      logger: createAppLogger({ name: 'todos-processing-publisher' }),
    }),
    userServiceClient,
    todoItemExtractionService: createTodoItemExtractionService(
      userServiceClient,
      createAppLogger({ name: 'todoItemExtractionService' })
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
