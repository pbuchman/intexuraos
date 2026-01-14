import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_ACTIONS_AGENT_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
];

validateRequiredEnv(REQUIRED_ENV);

initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'commands-agent',
});

async function main(): Promise<void> {
  await initServices({
    userServiceUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] as string,
    actionsAgentUrl: process.env['INTEXURAOS_ACTIONS_AGENT_URL'] as string,
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] as string,
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] as string,
    appSettingsServiceUrl: process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] as string,
  });

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

  const port = Number(process.env['PORT']) || 8080;
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch(() => {
  process.exit(1);
});
