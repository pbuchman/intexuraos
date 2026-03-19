import type { Logger } from '@intexuraos/common-core';
import type { ScheduleRepository } from './domain/ports/schedule-repository.js';
import type { ExecutionRepository } from './domain/ports/execution-repository.js';
import type { ToolRegistry } from './domain/ports/tool-registry.js';
import type { ToolCallingClient, LLMClient } from '@intexuraos/llm-contract';

export interface ServiceContainer {
  logger: Logger;
  scheduleRepo: ScheduleRepository;
  executionRepo: ExecutionRepository;
  toolRegistry: ToolRegistry;
  toolCallingClient: ToolCallingClient;
  geminiClient: LLMClient;
  internalAuthToken: string;
}

let container: ServiceContainer | null = null;

export function initServices(services: ServiceContainer): void {
  container = services;
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
