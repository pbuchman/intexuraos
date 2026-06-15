import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { installUsageSinkShutdownHandler } from '@intexuraos/llm-pricing';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_ACTIONS_AGENT_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_PUBSUB_ACTIONS_QUEUE',
  'INTEXURAOS_SERVICE_URL', // INT-1531: audience for Cloud Scheduler OIDC token verification
];

validateRequiredEnv(REQUIRED_ENV);

initSentry({
  ...(process.env['INTEXURAOS_SENTRY_DSN'] !== undefined && {
    dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  }),
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'commands-agent',
});

async function main(): Promise<void> {
  initServices({
    userServiceUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] as string,
    actionsAgentUrl: process.env['INTEXURAOS_ACTIONS_AGENT_URL'] as string,
    llmUsageServiceUrl: process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] as string,
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] as string,
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] as string,
  });

  const app = await buildServer();

  // Drain registered usage sinks on SIGTERM/SIGINT before exit so the 500ms
  // batching window doesn't lose events when Cloud Run scales down.
  installUsageSinkShutdownHandler({ app, logger: app.log });

  const port = Number(process.env['PORT']) || 8080;
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch(() => {
  process.exit(1);
});
