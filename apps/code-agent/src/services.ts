/**
 * Service wiring for code-agent.
 * Provides dependency injection for domain adapters.
 */

import pino from 'pino';
import type { Firestore } from '@google-cloud/firestore';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { CodeWorkersConfig } from './config.js';

export interface ServiceContainer {
  firestore: Firestore;
  logger: pino.Logger;
  // Add more services as needed
}

// Configuration required to initialize services
export interface ServiceConfig {
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  linearAgentUrl: string;
  actionsAgentUrl: string;
  dispatchSecret: string;
  webhookVerifySecret: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  codeWorkers: CodeWorkersConfig;
}

let container: ServiceContainer | null = null;

/**
 * Initialize services with config. Call this early in server startup.
 * MUST be called before getServices().
 */
export function initServices(_config: ServiceConfig): void {
  container = {
    firestore: getFirestore(),
    logger: pino({ name: 'code-agent' }),
    // Add more service initializations as needed
  };
}

/**
 * Get the service container. Throws if initServices() wasn't called.
 * DO NOT add fallbacks here - that creates test code in production.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

/**
 * Replace services for testing. Only use in tests.
 */
export function setServices(s: ServiceContainer): void {
  container = s;
}

/**
 * Reset services. Call in afterEach() in tests.
 */
export function resetServices(): void {
  container = null;
}
