/**
 * Service wiring for llm-orchestrator-service.
 * Provides dependency injection for domain adapters.
 */

/**
 * Service container holding all adapter instances.
 * Will be extended as domain adapters are implemented.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Placeholder, will be populated with adapters
export interface ServiceContainer {
  // TODO: Add ResearchRepository, LLM adapters, WhatsApp sender
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 */
export function getServices(): ServiceContainer {
  container ??= {};
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
