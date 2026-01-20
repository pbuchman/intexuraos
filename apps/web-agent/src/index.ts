import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_CRAWL4AI_API_KEY',
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

async function main(): Promise<void> {
  initServices();

  const app = await buildServer();

  const close = (): void => {
    app.close().then(
      () => {
        process.exit(0);
      },
      () => {
        process.exit(1);
      }
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port: PORT, host: HOST });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
