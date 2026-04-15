import { initSentry, createAppLogger } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
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

  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
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

  if (process.env['INTEXURAOS_GEMINI_APP_API_KEY'] === undefined || process.env['INTEXURAOS_GEMINI_APP_API_KEY'].length === 0) {
    logger.warn('INTEXURAOS_GEMINI_APP_API_KEY is not set — platform Gemini fallback unavailable; users must have their own Gemini API key configured');
  }

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
