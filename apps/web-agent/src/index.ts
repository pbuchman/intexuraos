import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { installUsageSinkShutdownHandler } from '@intexuraos/llm-pricing';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_CLOUDFLARE_ACCOUNT_ID',
  'INTEXURAOS_CLOUDFLARE_API_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
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
const LLM_USAGE_SERVICE_URL =
  process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? 'http://localhost:8113';
const INTERNAL_AUTH_TOKEN = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';

async function main(): Promise<void> {
  initServices({
    cloudflareAccountId: process.env['INTEXURAOS_CLOUDFLARE_ACCOUNT_ID'] ?? '',
    cloudflareApiToken: process.env['INTEXURAOS_CLOUDFLARE_API_TOKEN'] ?? '',
    userServiceUrl: USER_SERVICE_URL,
    internalAuthToken: INTERNAL_AUTH_TOKEN,
    llmUsageServiceUrl: LLM_USAGE_SERVICE_URL,
    openRouterAppApiKey: process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '',
  });

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
