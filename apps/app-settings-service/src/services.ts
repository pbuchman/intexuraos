/**
 * Service wiring for app-settings-service.
 * Provides dependency injection for domain adapters.
 */
import type { PricingRepository } from './domain/ports/index.js';
import { FirestorePricingRepository } from './infra/firestore/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  pricingRepository: PricingRepository;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 */
export function getServices(): ServiceContainer {
  container ??= {
    pricingRepository: new FirestorePricingRepository(),
  };
  return container;
}

/**
 * Set a custom service container (for testing).
 */
export function setServices(services: ServiceContainer): void {
  container = services;
}

/**
 * Reset the service container (for testing).
 */
export function resetServices(): void {
  container = null;
}
