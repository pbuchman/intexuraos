/**
 * WhatsApp Service entry point.
 */

import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { getServices } from './services.js';

const REQUIRED_ENV: string[] = [
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL',
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_WHATSAPP_ACCESS_TOKEN',
  'INTEXURAOS_WHATSAPP_APP_SECRET',
  'INTEXURAOS_WHATSAPP_WABA_ID',
  'INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID',
  'INTEXURAOS_WHATSAPP_VERIFY_TOKEN',
  'INTEXURAOS_WHATSAPP_MEDIA_BUCKET',
  'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC',
  'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION',
  'INTEXURAOS_WEB_AGENT_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL',
  'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN',
  'INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC',
  'INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC',
  'INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
];

if (process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED']?.trim() === 'true') {
  REQUIRED_ENV.push(
    'INTEXURAOS_ENVIRONMENT',
    'INTEXURAOS_INTEX_AGENT_URL',
    'INTEXURAOS_MATRIX_CORPUS_ENABLED',
    'INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE',
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
    'INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING',
    'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING',
    'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING',
    'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY'
  );
}

validateRequiredEnv(REQUIRED_ENV);

const sentryConfig: Parameters<typeof initSentry>[0] = {
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'whatsapp-service',
};
const dsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (dsn !== undefined) {
  sentryConfig.dsn = dsn;
}
initSentry(sentryConfig);

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);
  const port = config.port;
  const host = config.host;

  await app.listen({ port, host });
  if (config.matrixCorpus.enabled) {
    const recoveryController = getServices().matrixCorpus?.recoveryController;
    if (recoveryController === undefined) {
      throw new Error('Matrix corpus recovery composition is unavailable');
    }
    await recoveryController.start();
  }

  let shutdown: Promise<void> | null = null;
  const close = (): void => {
    shutdown ??= app.close();
    void shutdown.then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  app.log.info(`WhatsApp Service listening on ${host}:${String(port)}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
