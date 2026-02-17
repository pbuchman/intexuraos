import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, type ValidationModel } from '@intexuraos/llm-contract';
import { buildServer } from './server.js';
import { initializeServices } from './services.js';

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
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
  'INTEXURAOS_WEB_APP_URL',
  'INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID',
  'INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET',
];

validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
initSentry({
  ...(sentryDsn !== undefined ? { dsn: sentryDsn } : {}),
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'user-service',
});

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

/** Validation models used by user-service */
const REQUIRED_MODELS: ValidationModel[] = [
  LlmModels.Gemini20Flash,
  LlmModels.GPT4oMini,
  LlmModels.ClaudeHaiku35,
  LlmModels.Sonar,
];

async function main(): Promise<void> {
  const appSettingsUrl = process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';

  process.stdout.write(`Fetching pricing from ${appSettingsUrl}\n`);
  const pricingResult = await fetchAllPricing(appSettingsUrl, internalAuthToken);
  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  const pricingContext = createPricingContext(pricingResult.value, REQUIRED_MODELS);
  process.stdout.write(`Loaded pricing for ${String(REQUIRED_MODELS.length)} models: ${REQUIRED_MODELS.join(', ')}\n`);
  initializeServices(pricingContext);

  const app = await buildServer();

  const close = (): void => {
    app.close().then(
      () => {
        process.exit(0);
      },
      () => {
        process.exit(1);
      }
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port: PORT, host: HOST });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
