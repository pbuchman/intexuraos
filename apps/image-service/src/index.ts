import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import type { ImageModel, FastModel, ValidationModel } from '@intexuraos/llm-contract';
import { LlmModels } from '@intexuraos/llm-contract';
import { buildServer } from './server.js';
import { initializeServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_IMAGE_BUCKET',
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
];

validateRequiredEnv(REQUIRED_ENV);

initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'image-service',
});

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

/** Models used by image-service */
const REQUIRED_MODELS: (ImageModel | FastModel | ValidationModel)[] = [
  LlmModels.Gemini25Flash, // Prompt generation
  LlmModels.GPT4oMini, // Prompt generation
  LlmModels.GPTImage1, // Image generation
  LlmModels.Gemini25FlashImage, // Image generation
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
