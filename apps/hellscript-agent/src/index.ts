import { initSentry, createAppLogger } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { fetchAllPricingWithRetry, createPricingContext, HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { LlmModels, type LLMModel } from '@intexuraos/llm-contract';
import { createUserServiceClient } from '@intexuraos/internal-clients';
import { buildServer } from './server.js';
import { initServices } from './services.js';
import { loadConfig } from './config.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_SENTRY_DSN',
];

const REQUIRED_MODELS: LLMModel[] = [
  LlmModels.Gemini25Flash,
];

/* v8 ignore start -- module-init: entry point bootstrapping not unit-testable @preserve */
validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (sentryDsn === undefined || sentryDsn === '') {
  throw new Error('INTEXURAOS_SENTRY_DSN is required');
}

initSentry({
  dsn: sentryDsn,
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'hellscript-agent',
});

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createAppLogger({ name: 'hellscript-agent' });

  const pricingResult = await fetchAllPricingWithRetry(config.llmUsageServiceUrl, config.internalAuthToken);
  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  const pricingContext = createPricingContext(pricingResult.value, REQUIRED_MODELS);
  process.stdout.write(`Loaded pricing for ${String(REQUIRED_MODELS.length)} models: ${REQUIRED_MODELS.join(', ')}\n`);

  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext,
    logger: createAppLogger({ name: 'user-service-client' }),
    usageSink: new HttpInternalAuthUsageSink({
      usageServiceUrl: config.llmUsageServiceUrl,
      internalAuthToken: config.internalAuthToken,
      service: 'hellscript-agent',
      component: 'user-service-client',
      logger,
    }),
    platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
  });

  initServices({
    userServiceClient,
    logger,
  });

  const app = await buildServer();
  const port = config.port;

  const close = (): void => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start server: ${getErrorMessage(error, String(error))}\n`
  );
  process.exit(1);
});
/* v8 ignore stop @preserve */
