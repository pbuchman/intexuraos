import { initSentry, createAppLogger } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { createGeminiClient, TOOL_CALLING_PRICING } from '@intexuraos/infra-gemini';
import { LlmModels } from '@intexuraos/llm-contract';
import { buildServer } from './server.js';
import { initServices } from './services.js';
import { loadConfig } from './config.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_GEMINI_APP_API_KEY',
  'INTEXURAOS_SENTRY_DSN',
];

/* v8 ignore start -- module-init: entry point bootstrapping not unit-testable @preserve */
validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (sentryDsn === undefined || sentryDsn === '') {
  throw new Error('INTEXURAOS_SENTRY_DSN is required');
}

initSentry({
  dsn: sentryDsn,
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'hellscript-agent',
});

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createAppLogger({ name: 'hellscript-agent' });

  const geminiClient = createGeminiClient({
    apiKey: config.geminiApiKey,
    model: LlmModels.Gemini25Flash,
    userId: 'hellscript-agent-system',
    pricing: TOOL_CALLING_PRICING[LlmModels.Gemini25Flash],
    logger: createAppLogger({ name: 'gemini-client' }),
  });

  initServices({
    geminiClient,
    logger,
  });

  const app = await buildServer();
  const port = config.port;

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
  process.stderr.write(
    `Failed to start server: ${getErrorMessage(error, String(error))}\n`
  );
  process.exit(1);
});
/* v8 ignore stop @preserve */
