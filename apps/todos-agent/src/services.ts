import type { TodoRepository } from './domain/ports/todoRepository.js';
import { FirestoreTodoRepository } from './infra/firestore/firestoreTodoRepository.js';
import {
  createTodosProcessingPublisher,
  type TodosProcessingPublisher,
} from '@intexuraos/infra-pubsub';

export interface ServiceContainer {
  todoRepository: TodoRepository;
  todosProcessingPublisher: TodosProcessingPublisher;
}

export interface ServiceConfig {
  gcpProjectId: string;
  todosProcessingTopic: string;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  container = {
    todoRepository: new FirestoreTodoRepository(),
    todosProcessingPublisher: createTodosProcessingPublisher({
      projectId: config.gcpProjectId,
      topicName: config.todosProcessingTopic,
    }),
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
