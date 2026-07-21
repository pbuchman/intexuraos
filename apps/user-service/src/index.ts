/**
 * user-service entry point.
 *
 * Delegates the env-validation / Sentry / DI / listen / SIGTERM lifecycle to
 * `startFastifyService` from `@intexuraos/http-server`. `REQUIRED_ENV` is
 * declared `as const` so future call sites that want type-safe env access
 * via `loadEnv(REQUIRED_ENV)` get a typed `Record<...>` without re-listing
 * the keys. `startFastifyService` validates presence before the listen.
 */
import { startFastifyService } from '@intexuraos/http-server';
import { buildServer } from './server.js';
import { initServices } from './services.js';
import { loadConfig } from './config.js';

const REQUIRED_ENV: string[] = [
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
  'INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID',
  'INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED',
];

if (process.env['INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID'] !== 'disabled') {
  REQUIRED_ENV.push('INTEXURAOS_OPENROUTER_APP_API_KEY');
}

if (process.env['INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED'] === 'true') {
  REQUIRED_ENV.push(
    'INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE',
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'
  );
}

await startFastifyService({
  serviceName: 'user-service',
  requiredEnv: REQUIRED_ENV,
  initServices: async () => {
    await initServices(loadConfig());
  },
  buildServer,
});
