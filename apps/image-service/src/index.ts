import { initSentry } from '@intexuraos/infra-sentry';
import { assertOtelActive } from '@intexuraos/infra-otel';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { installUsageSinkShutdownHandler } from '@intexuraos/llm-pricing';
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
  'INTEXURAOS_IMAGE_PUBLIC_BASE_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
];

validateRequiredEnv(REQUIRED_ENV);
assertOtelActive({ serviceName: 'image-service' });

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];

initSentry({
  ...(sentryDsn !== undefined && { dsn: sentryDsn }),
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'image-service',
});

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
  initializeServices();

  const app = await buildServer();

  // Drain registered usage sinks on SIGTERM/SIGINT before exit so the 500ms
  // batching window doesn't lose events when Cloud Run scales down.
  installUsageSinkShutdownHandler({ app, logger: app.log });

  await app.listen({ port: PORT, host: HOST });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
