/**
 * user-service entry point.
 *
 * Delegates the env-validation / Sentry / DI / listen / SIGTERM lifecycle to
 * `startFastifyService` from `@intexuraos/http-server`. `REQUIRED_ENV` is
 * declared `as const` so future call sites that want type-safe env access
 * via `loadEnv(REQUIRED_ENV)` get a typed `Record<...>` without re-listing
 * the keys. `startFastifyService` validates presence before the listen.
 */
import { assertOtelActive } from '@intexuraos/infra-otel';
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

assertOtelActive({ serviceName: 'user-service' });

await startFastifyService({
  serviceName: 'user-service',
  requiredEnv: REQUIRED_ENV,
  initServices: () => {
    initServices();
  },
  buildServer,
});
