/**
 * Service wiring for data-insights-service.
 * Provides dependency injection for domain adapters.
 */
import type { DataSourceRepository } from './domain/dataSource/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  dataSourceRepository: DataSourceRepository;
}

export interface ServiceConfig {
  userServiceUrl: string;
  internalAuthToken: string;
}

let container: ServiceContainer | null = null;
let serviceConfig: ServiceConfig | null = null;

/**
 * Initialize services with config. Call this early in server startup.
 */
export function initServices(config: ServiceConfig, services: ServiceContainer): void {
  serviceConfig = config;
  container = services;
}

/**
 * Get the service container. Throws if initServices() wasn't called.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

/**
 * Get the service configuration.
 */
export function getServiceConfig(): ServiceConfig {
  if (serviceConfig === null) {
    throw new Error('Service config not initialized. Call initServices() first.');
  }
  return serviceConfig;
}

/**
 * Set a custom service container (for testing).
 */
export function setServices(services: ServiceContainer): void {
  container = services;
}

/**
 * Set a custom service config (for testing).
 */
export function setServiceConfig(config: ServiceConfig): void {
  serviceConfig = config;
}

/**
 * Reset the service container (for testing).
 */
export function resetServices(): void {
  container = null;
  serviceConfig = null;
}
