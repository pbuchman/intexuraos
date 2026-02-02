/**
 * Linear Agent entry point.
 */

import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, type LLMModel } from '@intexuraos/llm-contract';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
];

const REQUIRED_MODELS: LLMModel[] = [
  LlmModels.Gemini25Flash,
  LlmModels.Gemini25Pro,
  LlmModels.Glm47,
  LlmModels.Glm47Flash,
];

validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (sentryDsn === undefined || sentryDsn === '') {
  throw new Error('INTEXURAOS_SENTRY_DSN is required');
}

initSentry({
  dsn: sentryDsn,
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'linear-agent',
});

async function main(): Promise<void> {
  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  const appSettingsUrl = process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] ?? '';

  const pricingResult = await fetchAllPricing(appSettingsUrl, internalAuthToken);
  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  const pricingContext = createPricingContext(pricingResult.value, REQUIRED_MODELS);
  process.stdout.write(`Loaded pricing for ${String(REQUIRED_MODELS.length)} models: ${REQUIRED_MODELS.join(', ')}\n`);

  initServices({
    userServiceUrl,
    internalAuthToken,
    pricingContext,
  });

  const app = await buildServer();
  const port = Number(process.env['PORT'] ?? 8080);
  const host = '0.0.0.0';

  await app.listen({ port, host });
  app.log.info(`Linear Agent listening on ${host}:${String(port)}`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Failed to start Linear Agent: ${String(err)}\n`);
  process.exit(1);
});
