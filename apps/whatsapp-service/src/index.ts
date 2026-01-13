/**
 * WhatsApp Service entry point.
 */

import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

const REQUIRED_ENV = [
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_WHATSAPP_ACCESS_TOKEN',
  'INTEXURAOS_WHATSAPP_APP_SECRET',
  'INTEXURAOS_WHATSAPP_WABA_ID',
  'INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID',
  'INTEXURAOS_WHATSAPP_VERIFY_TOKEN',
  'INTEXURAOS_WHATSAPP_MEDIA_BUCKET',
  'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC',
  'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION',
  'INTEXURAOS_SPEECHMATICS_API_KEY',
  'INTEXURAOS_WEB_AGENT_URL',
];

validateRequiredEnv(REQUIRED_ENV);

initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'whatsapp-service',
});

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);
  const port = config.port;
  const host = config.host;

  await app.listen({ port, host });
  app.log.info(`WhatsApp Service listening on ${host}:${String(port)}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
