/**
 * Service wiring for user-service.
 *
 * Built on the shared `createServiceContainer` factory from
 * `@intexuraos/common-core`. Public entry points (`initServices`,
 * `getServices`, `setServices`, `resetServices`) match the canonical
 * IntexuraOS service-container shape introduced in INT-1529.
 */
import { createServiceContainer, type Logger } from '@intexuraos/common-core';
import { createEncryptor, type Encryptor } from './infra/encryption.js';
import {
  HttpInternalAuthUsageSink,
  NoopUsageSink,
  type UsageSink,
} from '@intexuraos/llm-pricing';
import { createAppLogger } from '@intexuraos/infra-sentry';
import type { Auth0Client, AuthTokenRepository } from './domain/identity/index.js';
import type { LlmValidator, UserSettingsRepository } from './domain/settings/index.js';
import type {
  OAuthConnectionRepository,
  GoogleOAuthClient,
  GitHubOAuthClient,
} from './domain/oauth/index.js';
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
import { GitHubOAuthClientImpl } from './infra/github/index.js';

export interface ServiceContainer {
  authTokenRepository: AuthTokenRepository;
  userSettingsRepository: UserSettingsRepository;
  oauthConnectionRepository: OAuthConnectionRepository;
  auth0Client: Auth0Client | null;
  googleOAuthClient: GoogleOAuthClient | null;
  gitHubOAuthClient: GitHubOAuthClient | null;
  encryptor: Encryptor | null;
  llmValidator: LlmValidator | null;
}

/** Optional bootstrap logger; defaults to the app logger when unset. */
export interface ServiceContainerConfig {
  logger?: Logger;
}

function loadEncryptor(): Encryptor | null {
  const encryptionKey = process.env['INTEXURAOS_ENCRYPTION_KEY'];
  if (encryptionKey === undefined || encryptionKey === '') {
    return null;
  }
  return createEncryptor(encryptionKey);
}

function loadGoogleOAuthClient(): GoogleOAuthClient | null {
  const clientId = process.env['INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID'];
  const clientSecret = process.env['INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET'];
  if (
    clientId === undefined ||
    clientId === '' ||
    clientSecret === undefined ||
    clientSecret === ''
  ) {
    return null;
  }
  return new GoogleOAuthClientImpl({ clientId, clientSecret });
}

function loadGitHubOAuthClient(): GitHubOAuthClient | null {
  const clientId = process.env['INTEXURAOS_GITHUB_OAUTH_CLIENT_ID'];
  const clientSecret = process.env['INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET'];
  if (
    clientId === undefined ||
    clientId === '' ||
    clientSecret === undefined ||
    clientSecret === ''
  ) {
    return null;
  }
  return new GitHubOAuthClientImpl({ clientId, clientSecret });
}

function buildContainer(config?: ServiceContainerConfig): ServiceContainer {
  const logger: Logger = config?.logger ?? createAppLogger({ name: 'user-service' });
  const auth0Config = loadAuth0ConfigFromInfra();
  const isTestEnv = process.env['NODE_ENV'] === 'test';

  let llmValidator: LlmValidator | null = null;
  if (!isTestEnv) {
    const llmUsageServiceUrl = process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? '';
    const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
    const validatorUsageSink: UsageSink =
      llmUsageServiceUrl !== '' && internalAuthToken !== ''
        ? new HttpInternalAuthUsageSink({
            usageServiceUrl: llmUsageServiceUrl,
            internalAuthToken,
            service: 'user-service',
            component: 'llm-validator',
            logger,
          })
        : new NoopUsageSink();
    llmValidator = new LlmValidatorImpl(logger, validatorUsageSink);
  }

  return {
    authTokenRepository: new FirestoreAuthTokenRepository(),
    userSettingsRepository: new FirestoreUserSettingsRepository(),
    oauthConnectionRepository: new FirestoreOAuthConnectionRepository(),
    auth0Client: auth0Config !== null ? new Auth0ClientImpl(auth0Config) : null,
    googleOAuthClient: loadGoogleOAuthClient(),
    gitHubOAuthClient: loadGitHubOAuthClient(),
    encryptor: loadEncryptor(),
    llmValidator,
  };
}

const handle = createServiceContainer<ServiceContainer, ServiceContainerConfig | undefined>(
  buildContainer
);

/** Initialize the service container with all dependencies. */
export const initServices = (config?: ServiceContainerConfig): void => {
  handle.init(config);
};

/** Get the initialized container. Throws if `initServices` was not called. */
export const getServices = (): ServiceContainer => handle.get();

/**
 * Override (a portion of) the service container — primarily for tests.
 *
 * Accepts either a partial override (recommended) or a complete container.
 * If the container is not yet initialized, this auto-initializes it first
 * so tests can call `setServices({...})` without a preceding `initServices()`
 * (preserving the legacy behavior of the previous `setServices(full)` API).
 */
export const setServices = (override: Partial<ServiceContainer>): void => {
  try {
    handle.get();
  } catch {
    handle.init();
  }
  handle.set(override);
};

/** Reset the container so the next `getServices` throws. */
export const resetServices = (): void => {
  handle.reset();
};
