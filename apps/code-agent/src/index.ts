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
  'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_LINEAR_AGENT_URL',
  'INTEXURAOS_ACTIONS_AGENT_URL',
  'INTEXURAOS_DISPATCH_SIGNING_SECRET',
  'INTEXURAOS_WEBHOOK_VERIFY_SECRET',
  'INTEXURAOS_CF_ACCESS_CLIENT_ID',
  'INTEXURAOS_CF_ACCESS_CLIENT_SECRET',
  'INTEXURAOS_ORCHESTRATOR_MAC_URL',
  'INTEXURAOS_ORCHESTRATOR_VM_URL',
  'INTEXURAOS_CODE_WORKERS',
  'INTEXURAOS_SERVICE_URL',
  // Auth0 JWT validation for public routes
  'INTEXURAOS_AUTH0_AUDIENCE',
  'INTEXURAOS_AUTH0_ISSUER',
  'INTEXURAOS_AUTH0_JWKS_URI',
];

validateRequiredEnv(REQUIRED_ENV);

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
    dispatchSigningSecret: config.dispatchSigningSecret,
    webhookVerifySecret: config.webhookVerifySecret,
    cfAccessClientId: config.cfAccessClientId,
    cfAccessClientSecret: config.cfAccessClientSecret,
    orchestratorMacUrl: config.orchestratorMacUrl,
    orchestratorVmUrl: config.orchestratorVmUrl,
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
