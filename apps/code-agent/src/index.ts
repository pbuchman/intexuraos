import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { initServices } from './services.js';

// Fail-fast startup validation - crashes immediately if required vars are missing
const REQUIRED_ENV = [
  'NODE_ENV',
  'PORT',
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_INTERNAL_AUTH_SECRET',
  'INTEXURAOS_FIRESTORE_PROJECT_ID',
  'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'INTEXURAOS_LINEAR_AGENT_URL',
  'INTEXURAOS_ACTIONS_AGENT_URL',
  'INTEXURAOS_DISPATCH_SECRET',
  'INTEXURAOS_WEBHOOK_VERIFY_SECRET',
  'INTEXURAOS_CF_ACCESS_CLIENT_ID',
  'INTEXURAOS_CF_ACCESS_CLIENT_SECRET',
  'INTEXURAOS_CODE_WORKERS',
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
    internalAuthToken: config.internalAuthToken,
    firestoreProjectId: config.firestoreProjectId,
    whatsappServiceUrl: config.whatsappServiceUrl,
    linearAgentUrl: config.linearAgentUrl,
    actionsAgentUrl: config.actionsAgentUrl,
    dispatchSecret: config.dispatchSecret,
    webhookVerifySecret: config.webhookVerifySecret,
    cfAccessClientId: config.cfAccessClientId,
    cfAccessClientSecret: config.cfAccessClientSecret,
    codeWorkers: config.codeWorkers,
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
