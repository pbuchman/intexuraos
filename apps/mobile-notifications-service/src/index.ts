import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_DIGEST_LLM_MODEL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_WEB_APP_URL',
];

validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
initSentry(
  sentryDsn === undefined
    ? {
        environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
        serviceName: 'mobile-notifications-service',
      }
    : {
        dsn: sentryDsn,
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
