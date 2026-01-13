import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_SENTRY_DSN',
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_WEB_AGENT_URL',
];

validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];

async function main(): Promise<void> {
  const enrichTopic = process.env['INTEXURAOS_PUBSUB_BOOKMARK_ENRICH'];

  initServices({
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    webAgentUrl: process.env['INTEXURAOS_WEB_AGENT_URL'] ?? '',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    bookmarkEnrichTopic: enrichTopic !== undefined && enrichTopic !== '' ? enrichTopic : null,
  });

  const app = await buildServer();
  const port = parseInt(process.env['PORT'] ?? '8080', 10);

  const close = (): void => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
