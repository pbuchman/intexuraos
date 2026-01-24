import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, type LLMModel } from '@intexuraos/llm-contract';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_CRAWL4AI_API_KEY',
];

validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (sentryDsn === undefined || sentryDsn === '') {
  throw new Error('INTEXURAOS_SENTRY_DSN is required');
}

initSentry({
  dsn: sentryDsn,
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'web-agent',
});

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

// Default URLs for local development
const USER_SERVICE_URL = process.env['INTEXURAOS_USER_SERVICE_URL'] ?? 'http://localhost:8110';
const APP_SETTINGS_SERVICE_URL =
  process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] ?? 'http://localhost:8113';
const INTERNAL_AUTH_TOKEN = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';

// Models used by this service
const REQUIRED_MODELS: LLMModel[] = [LlmModels.Gemini25Flash];

async function main(): Promise<void> {
  // Fetch pricing from app-settings-service
  process.stdout.write(`Fetching pricing from ${APP_SETTINGS_SERVICE_URL}\n`);
  const pricingResult = await fetchAllPricing(APP_SETTINGS_SERVICE_URL, INTERNAL_AUTH_TOKEN);
  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }
  const pricingContext = createPricingContext(pricingResult.value, [...REQUIRED_MODELS]);
  process.stdout.write(`Loaded pricing for ${String(REQUIRED_MODELS.length)} models\n`);

  initServices({
    crawl4aiApiKey: process.env['INTEXURAOS_CRAWL4AI_API_KEY'] ?? '',
    userServiceUrl: USER_SERVICE_URL,
    internalAuthToken: INTERNAL_AUTH_TOKEN,
    pricingContext,
  });

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
