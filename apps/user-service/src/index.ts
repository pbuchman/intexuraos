/**
 * user-service entry point.
 *
 * Delegates the env-validation / Sentry / DI / listen / SIGTERM lifecycle to
 * `startFastifyService` from `@intexuraos/http-server`. `loadEnv` provides
 * type-safe access to the required env variables (no `as string` casts or
 * `?? ''` fallbacks).
 */
import { loadEnv } from '@intexuraos/common-core';
import { startFastifyService } from '@intexuraos/http-server';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH0_DOMAIN',
  'INTEXURAOS_AUTH0_CLIENT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
  'INTEXURAOS_ENCRYPTION_KEY',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_WEB_APP_URL',
  'INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID',
  'INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET',
  'INTEXURAOS_GITHUB_OAUTH_CLIENT_ID',
  'INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET',
] as const;

// Eagerly verify presence + narrow types for any callers downstream that want
// `loadEnv(REQUIRED_ENV)` access. `startFastifyService` re-validates inside
// before initSentry/listen.
void loadEnv(REQUIRED_ENV);

await startFastifyService({
  serviceName: 'user-service',
  requiredEnv: REQUIRED_ENV,
  initServices: () => {
    initServices();
  },
  buildServer,
});
