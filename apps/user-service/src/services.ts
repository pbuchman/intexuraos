/**
 * Service wiring for user-service.
 * Provides dependency injection for domain adapters.
 */
import { LlmModels } from '@intexuraos/llm-contract';
import { createEncryptor, type Encryptor } from './infra/encryption.js';
import type { PricingContext } from '@intexuraos/llm-pricing';
import type { Logger } from '@intexuraos/common-core';
import type { Auth0Client, AuthTokenRepository } from './domain/identity/index.js';
import type { LlmValidator, UserSettingsRepository } from './domain/settings/index.js';
import type { OAuthConnectionRepository, GoogleOAuthClient } from './domain/oauth/index.js';
import {
  FirestoreAuthTokenRepository,
  FirestoreUserSettingsRepository,
  FirestoreOAuthConnectionRepository,
} from './infra/firestore/index.js';
import {
  Auth0ClientImpl,
  loadAuth0Config as loadAuth0ConfigFromInfra,
} from './infra/auth0/index.js';
import { LlmValidatorImpl } from './infra/llm/index.js';
import { GoogleOAuthClientImpl } from './infra/google/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  authTokenRepository: AuthTokenRepository;
  userSettingsRepository: UserSettingsRepository;
  oauthConnectionRepository: OAuthConnectionRepository;
  auth0Client: Auth0Client | null;
  googleOAuthClient: GoogleOAuthClient | null;
  encryptor: Encryptor | null;
  llmValidator: LlmValidator | null;
}

let container: ServiceContainer | null = null;

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
 * Load Google OAuth config from environment.
 * Returns null if not configured.
 */
function loadGoogleOAuthClient(): GoogleOAuthClient | null {
  const clientId = process.env['INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID'];
  const clientSecret = process.env['INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET'];

  if (clientId === undefined || clientId === '' || clientSecret === undefined || clientSecret === '') {
    return null;
  }

  return new GoogleOAuthClientImpl({ clientId, clientSecret });
}

/**
 * Get or create the service container.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initializeServices() first.');
  }
  return container;
}

/**
 * Initialize the service container with all dependencies.
 * @param pricingContext - Pricing context for LLM validation (optional in test env)
 * @param logger - Logger for LLM validation (optional in test env)
 */
export function initializeServices(pricingContext?: PricingContext, logger?: Logger): void {
  const auth0Config = loadAuth0ConfigFromInfra();
  // LlmValidator is null in test environment to skip actual API calls
  const isTestEnv = process.env['NODE_ENV'] === 'test';

  let llmValidator: LlmValidator | null = null;
  if (!isTestEnv && pricingContext !== undefined && logger !== undefined) {
    const validationPricing = {
      google: pricingContext.getPricing(LlmModels.Gemini20Flash),
      openai: pricingContext.getPricing(LlmModels.GPT4oMini),
      anthropic: pricingContext.getPricing(LlmModels.ClaudeHaiku35),
      perplexity: pricingContext.getPricing(LlmModels.Sonar),
      zai: pricingContext.getPricing(LlmModels.Glm47),
    };
    llmValidator = new LlmValidatorImpl(validationPricing, logger);
  }

  container = {
    authTokenRepository: new FirestoreAuthTokenRepository(),
    userSettingsRepository: new FirestoreUserSettingsRepository(),
    oauthConnectionRepository: new FirestoreOAuthConnectionRepository(),
    auth0Client: auth0Config !== null ? new Auth0ClientImpl(auth0Config) : null,
    googleOAuthClient: loadGoogleOAuthClient(),
    encryptor: loadEncryptor(),
    llmValidator,
  };
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
