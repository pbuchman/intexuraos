/**
 * Service wiring for user-service.
 * Provides dependency injection for domain adapters.
 */
import { createEncryptor, type Encryptor } from '@intexuraos/common-core';
import type { Auth0Client, AuthTokenRepository } from './domain/identity/index.js';
import type { LlmValidator, UserSettingsRepository } from './domain/settings/index.js';
import {
  FirestoreAuthTokenRepository,
  FirestoreUserSettingsRepository,
} from './infra/firestore/index.js';
import {
  Auth0ClientImpl,
  loadAuth0Config as loadAuth0ConfigFromInfra,
} from './infra/auth0/index.js';
import { LlmValidatorImpl } from './infra/llm/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  authTokenRepository: AuthTokenRepository;
  userSettingsRepository: UserSettingsRepository;
  auth0Client: Auth0Client | null;
  encryptor: Encryptor | null;
  llmValidator: LlmValidator | null;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 */
/**
 * Load encryption key from environment and create encryptor.
 * Returns null if key is not configured (optional feature).
 */
function loadEncryptor(): Encryptor | null {
  const encryptionKey = process.env['INTEXURAOS_ENCRYPTION_KEY'];
  if (encryptionKey === undefined || encryptionKey === '') {
    return null;
  }
  return createEncryptor(encryptionKey);
}

/**
 * Get or create the service container.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    const auth0Config = loadAuth0ConfigFromInfra();
    // LlmValidator is null in test environment to skip actual API calls
    const isTestEnv = process.env['NODE_ENV'] === 'test';
    container = {
      authTokenRepository: new FirestoreAuthTokenRepository(),
      userSettingsRepository: new FirestoreUserSettingsRepository(),
      auth0Client: auth0Config !== null ? new Auth0ClientImpl(auth0Config) : null,
      encryptor: loadEncryptor(),
      llmValidator: isTestEnv ? null : new LlmValidatorImpl(),
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
