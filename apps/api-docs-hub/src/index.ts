/**
 * API Docs Hub entry point.
 */

import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import pino from 'pino';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

const REQUIRED_ENV = [
  'INTEXURAOS_SENTRY_DSN',
];

validateRequiredEnv(REQUIRED_ENV);

initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'api-docs-hub',
});

const logger = pino({
  name: 'api-docs-hub',
});

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);
  const port = Number(process.env['PORT'] ?? 8080);
  const host = process.env['HOST'] ?? '0.0.0.0';

  await app.listen({ port, host });
  app.log.info(`API Docs Hub listening on ${host}:${String(port)}`);
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Fatal error during startup');
  process.exit(1);
});
