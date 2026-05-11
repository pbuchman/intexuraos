import { validateRequiredEnv } from '@intexuraos/http-server';
import { assertOtelActive } from '@intexuraos/infra-otel';
import { getErrorMessage } from '@intexuraos/common-core';
import { installUsageSinkShutdownHandler } from '@intexuraos/llm-pricing';
import { buildServer } from './server.js';
import { initializeServices } from './services.js';
import { initSentry } from '@intexuraos/infra-sentry';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_WEB_APP_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_NOTION_SERVICE_URL',
  'INTEXURAOS_IMAGE_PUBLIC_BASE_URL',
  'INTEXURAOS_IMAGE_SERVICE_URL',
  'INTEXURAOS_SHARE_BASE_URL',
  'INTEXURAOS_SHARED_CONTENT_BUCKET',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC',
  'INTEXURAOS_PUBSUB_LLM_CALL_TOPIC',
];

validateRequiredEnv(REQUIRED_ENV);
assertOtelActive({ serviceName: 'research-agent' });

const sentryConfig: Parameters<typeof initSentry>[0] = {
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'research-agent',
};
const dsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (dsn !== undefined) {
  sentryConfig.dsn = dsn;
}
initSentry(sentryConfig);

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
  // Initialize dependency injection container
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
