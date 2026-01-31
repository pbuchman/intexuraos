/**
 * Service wiring for chat-agent.
 * Provides dependency injection for domain adapters.
 */

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  generateId: () => string;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 * Throws if container has not been initialized.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initializeServices() first.');
  }
  return container;
}

/**
 * Set a custom service container (for testing or initialization).
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

/**
 * Initialize the service container with all dependencies.
 */
export function initializeServices(): void {
  container = {
    generateId: (): string => crypto.randomUUID(),
  };
}
