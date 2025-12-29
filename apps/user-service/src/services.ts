/**
 * Service wiring for user-service.
 * Provides dependency injection for domain adapters.
 */
import type { AuthTokenRepository, Auth0Client } from './domain/identity/index.js';
import { FirestoreAuthTokenRepository } from './infra/firestore/index.js';
import {
  Auth0ClientImpl,
  loadAuth0Config as loadAuth0ConfigFromInfra,
} from './infra/auth0/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  authTokenRepository: AuthTokenRepository;
  auth0Client: Auth0Client | null;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    const auth0Config = loadAuth0ConfigFromInfra();
    container = {
      authTokenRepository: new FirestoreAuthTokenRepository(),
      auth0Client: auth0Config !== null ? new Auth0ClientImpl(auth0Config) : null,
    };
  }
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
