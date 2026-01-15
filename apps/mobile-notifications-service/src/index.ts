import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
];

validateRequiredEnv(REQUIRED_ENV);

initSentry(
  process.env['INTEXURAOS_SENTRY_DSN'] === undefined
    ? {
        environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
        serviceName: 'mobile-notifications-service',
      }
    : {
        dsn: process.env['INTEXURAOS_SENTRY_DSN'],
        environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
        serviceName: 'mobile-notifications-service',
      }
);

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
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

main().catch(() => {
  process.exit(1);
});
