import { getErrorMessage } from '@intexuraos/common-core';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { initSentry } from '@intexuraos/infra-sentry';
import { installUsageSinkShutdownHandler } from '@intexuraos/llm-pricing';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV: string[] = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_NOTES_AGENT_URL',
  'INTEXURAOS_CALENDAR_AGENT_URL',
  'INTEXURAOS_RESEARCH_AGENT_URL',
  'INTEXURAOS_BOOKMARKS_AGENT_URL',
  'INTEXURAOS_CODE_AGENT_URL',
  'INTEXURAOS_WEB_APP_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS',
  'INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED',
];

if (process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED']?.trim() === 'true') {
  REQUIRED_ENV.push(
    'INTEXURAOS_ENVIRONMENT',
    'INTEXURAOS_MATRIX_CORPUS_ENABLED',
    'INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME',
    'INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY'
  );
}

validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
initSentry({
  ...(sentryDsn !== undefined ? { dsn: sentryDsn } : {}),
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'intex-agent',
});

async function main(): Promise<void> {
  const config = loadConfig();
  await initServices(config);

  const app = await buildServer();
  installUsageSinkShutdownHandler({ app, logger: app.log });

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
