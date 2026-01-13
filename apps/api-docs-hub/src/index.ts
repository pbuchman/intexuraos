import { initSentry } from '@intexuraos/infra-sentry';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];

main().catch(() => {
  process.exit(1);
});
