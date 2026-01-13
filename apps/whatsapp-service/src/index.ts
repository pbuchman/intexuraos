import { initSentry } from '@intexuraos/infra-sentry';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { initServices } from './services.js';

async function main(): Promise<void> {
  const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
