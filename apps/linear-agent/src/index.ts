/**
 * Linear Agent entry point.
 */
import { assertOtelActive } from '@intexuraos/infra-otel';

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
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_CODE_AGENT_URL',
];

validateRequiredEnv(REQUIRED_ENV);
assertOtelActive({ serviceName: 'linear-agent' });

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (sentryDsn === undefined || sentryDsn === '') {
  throw new Error('INTEXURAOS_SENTRY_DSN is required');
}

initSentry({
  dsn: sentryDsn,
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'linear-agent',
});

async function main(): Promise<void> {
  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '';
  const codeAgentUrl = process.env['INTEXURAOS_CODE_AGENT_URL'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  const usageServiceUrl = process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? '';

  initServices({
    userServiceUrl,
    codeAgentUrl,
    internalAuthToken,
    llmUsageServiceUrl: usageServiceUrl,
  });

  const app = await buildServer();
  const port = Number(process.env['PORT'] ?? 8080);
  const host = '0.0.0.0';

  // Drain registered usage sinks on SIGTERM/SIGINT before exit so the 500ms
  // batching window doesn't lose events when Cloud Run scales down.
  installUsageSinkShutdownHandler({ app, logger: app.log });

  await app.listen({ port, host });
  app.log.info(`Linear Agent listening on ${host}:${String(port)}`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Failed to start Linear Agent: ${String(err)}\n`);
  process.exit(1);
});
