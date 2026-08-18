import { getErrorMessage } from '@intexuraos/common-core';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { initSentry } from '@intexuraos/infra-sentry';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL',
  'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
];

validateRequiredEnv(REQUIRED_ENV);

const config = loadConfig();

initSentry({
  environment: config.environment,
  serviceName: 'fishing-assistant-service',
  ...(config.sentryDsn !== undefined ? { dsn: config.sentryDsn } : {}),
});

async function main(): Promise<void> {
  initServices(config);

  const app = await buildServer();

  const close = (): void => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
