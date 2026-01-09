import type { TodoRepository } from './domain/ports/todoRepository.js';
import { FirestoreTodoRepository } from './infra/firestore/firestoreTodoRepository.js';

export interface ServiceContainer {
  todoRepository: TodoRepository;
}

export interface ServiceConfig {
  gcpProjectId: string;
}

let container: ServiceContainer | null = null;

export function initServices(_config: ServiceConfig): void {
  container = {
    todoRepository: new FirestoreTodoRepository(),
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
