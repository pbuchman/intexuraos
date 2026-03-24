import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { initServices } from './services.js';
import { loadConfig } from './config.js';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { FirestoreScheduleRepository } from './infra/firestore-schedule-repository.js';
import { FirestoreExecutionRepository } from './infra/firestore-execution-repository.js';
import { OpenApiToolRegistry } from './infra/openapi-tool-registry.js';
import { createGeminiClient, createGeminiToolCallingClient, TOOL_CALLING_PRICING } from '@intexuraos/infra-gemini';
import { LlmModels } from '@intexuraos/llm-contract';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_GEMINI_APP_API_KEY',
  'INTEXURAOS_SENTRY_DSN',
  'INTEXURAOS_ENVIRONMENT',
];

const PRODUCTION_ONLY_ENV = [
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_JWKS_URL',
];

/* v8 ignore start -- module-init: entry point bootstrapping not unit-testable @preserve */
const isProd = process.env['INTEXURAOS_ENVIRONMENT'] === 'production';
validateRequiredEnv([...REQUIRED_ENV, ...(isProd ? PRODUCTION_ONLY_ENV : [])]);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (sentryDsn === undefined || sentryDsn === '') {
  throw new Error('INTEXURAOS_SENTRY_DSN is required');
}

initSentry({
  dsn: sentryDsn,
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'cron-agent',
});

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createAppLogger({ name: 'cron-agent' });

  logger.info(
    { count: config.allowedServices.length, services: config.allowedServices.map((s) => s.key) },
    'Allowed services configured for cron-agent',
  );

  const toolRegistry = new OpenApiToolRegistry({
    allowedServices: config.allowedServices,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'tool-registry' }),
  });

  const toolCallingClient = createGeminiToolCallingClient({
    apiKey: config.geminiApiKey,
    model: LlmModels.Gemini25Flash,
    userId: 'cron-agent-system',
    pricing: TOOL_CALLING_PRICING[LlmModels.Gemini25Flash],
    logger: createAppLogger({ name: 'tool-calling' }),
  });

  const geminiClient = createGeminiClient({
    apiKey: config.geminiApiKey,
    model: LlmModels.Gemini25Flash,
    userId: 'cron-agent-system',
    pricing: TOOL_CALLING_PRICING[LlmModels.Gemini25Flash],
    logger: createAppLogger({ name: 'gemini-client' }),
  });

  initServices({
    logger,
    scheduleRepo: new FirestoreScheduleRepository(),
    executionRepo: new FirestoreExecutionRepository(),
    toolRegistry,
    toolCallingClient,
    geminiClient,
    internalAuthToken: config.internalAuthToken,
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
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
/* v8 ignore stop @preserve */
