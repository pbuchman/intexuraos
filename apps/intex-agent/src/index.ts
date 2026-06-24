import { getErrorMessage } from '@intexuraos/common-core';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { initSentry } from '@intexuraos/infra-sentry';
import { installUsageSinkShutdownHandler } from '@intexuraos/llm-pricing';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_NOTES_AGENT_URL',
  'INTEXURAOS_CALENDAR_AGENT_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS',
];

validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
initSentry({
  ...(sentryDsn !== undefined ? { dsn: sentryDsn } : {}),
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'intex-agent',
});

async function main(): Promise<void> {
  const config = loadConfig();
  initServices(config);

  const app = await buildServer();
  installUsageSinkShutdownHandler({ app, logger: app.log });

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
