/**
 * Calendar Agent entry point.
 */

import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
];

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (sentryDsn !== undefined) {
  initSentry({
    dsn: sentryDsn,
    environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
    serviceName: 'calendar-agent',
  });
}

async function main(): Promise<void> {
  validateRequiredEnv(REQUIRED_ENV);

  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';

  initServices({
    userServiceUrl,
    internalAuthToken,
  });

  const app = await buildServer();
  const port = Number(process.env['PORT'] ?? 8125);
  const host = '0.0.0.0';

  await app.listen({ port, host });
  app.log.info(`Calendar Agent listening on ${host}:${String(port)}`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Failed to start Calendar Agent: ${String(err)}\n`);
  process.exit(1);
});
