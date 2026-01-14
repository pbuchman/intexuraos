import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_TODOS_PROCESSING_TOPIC',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
];

validateRequiredEnv(REQUIRED_ENV);

initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'todos-agent',
});

async function main(): Promise<void> {
  await initServices({
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    todosProcessingTopic: process.env['INTEXURAOS_TODOS_PROCESSING_TOPIC'] ?? '',
    internalAuthKey: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    userServiceUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] ?? 'http://localhost:8110',
    appSettingsServiceUrl: process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] ?? 'http://localhost:8113',
  });

  const app = await buildServer();

  const close = (): void => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  const port = parseInt(process.env['PORT'] ?? '8080', 10);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
