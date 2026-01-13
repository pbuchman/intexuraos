/**
 * API Docs Hub entry point.
 */

import { initSentry } from '@intexuraos/infra-sentry';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'api-docs-hub',
});

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);
  const port = Number(process.env['PORT'] ?? 8080);
  const host = process.env['HOST'] ?? '0.0.0.0';

  await app.listen({ port, host });
  app.log.info(`API Docs Hub listening on ${host}:${String(port)}`);
}

main().catch((error: unknown) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
