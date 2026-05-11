import { initSentry } from '@intexuraos/infra-sentry';
import { assertOtelActive } from '@intexuraos/infra-otel';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { initServices } from './services.js';
import { loadConfig } from './config.js';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { FirestoreScheduleRepository } from './infra/firestore-schedule-repository.js';
import { FirestoreExecutionRepository } from './infra/firestore-execution-repository.js';
import { OpenApiToolRegistry } from './infra/openapi-tool-registry.js';
import { createGeminiClient, createGeminiToolCallingClient } from '@intexuraos/infra-gemini';
import { LlmModels } from '@intexuraos/llm-contract';
import { HttpInternalAuthUsageSink, installUsageSinkShutdownHandler } from '@intexuraos/llm-pricing';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_GEMINI_APP_API_KEY',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
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
assertOtelActive({ serviceName: 'cron-agent' });

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
    { serviceCount: config.allowedServices.length, serviceKeys: config.allowedServices.map((s) => s.key) },
    'Config loaded — allowed services from environment',
  );

  const toolRegistry = new OpenApiToolRegistry({
    allowedServices: config.allowedServices,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'tool-registry' }),
  });

  const buildUsageSink = (component: string): HttpInternalAuthUsageSink =>
    new HttpInternalAuthUsageSink({
      usageServiceUrl: config.llmUsageServiceUrl,
      internalAuthToken: config.internalAuthToken,
      service: 'cron-agent',
      component,
      logger,
    });

  const toolCallingClient = createGeminiToolCallingClient({
    apiKey: config.geminiApiKey,
    model: LlmModels.Gemini25Flash,
    userId: 'cron-agent-system',
    logger: createAppLogger({ name: 'tool-calling' }),
    usageSink: buildUsageSink('tool-calling'),
  });

  const geminiClient = createGeminiClient({
    apiKey: config.geminiApiKey,
    model: LlmModels.Gemini25Flash,
    userId: 'cron-agent-system',
    logger: createAppLogger({ name: 'gemini-client' }),
    usageSink: buildUsageSink('gemini-client'),
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

  // Drain registered usage sinks on SIGTERM/SIGINT before exit so the 500ms
  // batching window doesn't lose events when Cloud Run scales down.
  installUsageSinkShutdownHandler({ app, logger });

  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
/* v8 ignore stop @preserve */
