import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { initServices } from './services.js';

// Fail-fast startup validation - crashes immediately if required vars are missing
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_WEBHOOK_VERIFY_SECRET',
  'INTEXURAOS_TOKEN_ENCRYPTION_KEY', // For per-user worker credentials encryption (has dev fallback)
  'INTEXURAOS_ORCHESTRATOR_SECRET', // For HMAC signature validation from orchestrator
  'INTEXURAOS_GITHUB_WEBHOOK_SECRET', // For GitHub webhook signature verification
];

/**
 * Optional env vars - used but not strictly required (for E2E or conditional features):
 * - E2E_MODE, E2E_TEST_USER_ID: E2E testing mode flags
 * - INTEXURAOS_WHATSAPP_SERVICE_URL, INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: WhatsApp integration
 * - INTEXURAOS_LINEAR_AGENT_URL, INTEXURAOS_ACTIONS_AGENT_URL: Service integrations
 * - INTEXURAOS_SERVICE_URL: Worker configuration
 * - INTEXURAOS_WEB_URL: Web app URL for generating task links (defaults to https://intexuraos.cloud)
 * - INTEXURAOS_AUTH_AUDIENCE, INTEXURAOS_AUTH_ISSUER, INTEXURAOS_AUTH_JWKS_URL: Auth0 JWT
 * - INTEXURAOS_LINEAR_CLIENT_ID, INTEXURAOS_LINEAR_CLIENT_SECRET: Linear OAuth (Agents Platform)
 * - INTEXURAOS_LINEAR_WEBHOOK_SECRET: Linear webhook signature verification
 */

// Additional env vars required in production but optional in E2E mode
const PRODUCTION_ONLY_ENV = [
  'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_LINEAR_AGENT_URL',
  'INTEXURAOS_ACTIONS_AGENT_URL',
  'INTEXURAOS_SERVICE_URL',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_LINEAR_CLIENT_ID',
  'INTEXURAOS_LINEAR_CLIENT_SECRET',
  'INTEXURAOS_LINEAR_WEBHOOK_SECRET',
];

// In E2E mode, only validate core env vars; others have sensible defaults
const isE2eMode = process.env['E2E_MODE'] === 'true';
validateRequiredEnv(isE2eMode ? REQUIRED_ENV : [...REQUIRED_ENV, ...PRODUCTION_ONLY_ENV]);

// Initialize Sentry (required - DSN is validated above)
const dsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (dsn !== undefined) {
  initSentry({
    dsn,
    environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
    serviceName: 'code-agent',
  });
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Initialize services with config BEFORE building server
  initServices({
    gcpProjectId: config.gcpProjectId,
    internalAuthToken: config.internalAuthToken,
    firestoreProjectId: config.firestoreProjectId,
    whatsappServiceUrl: config.whatsappServiceUrl,
    whatsappSendTopic: config.whatsappSendTopic,
    linearAgentUrl: config.linearAgentUrl,
    actionsAgentUrl: config.actionsAgentUrl,
    webhookVerifySecret: config.webhookVerifySecret,
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

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
