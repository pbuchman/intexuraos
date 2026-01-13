import { initSentry } from '@intexuraos/infra-sentry';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
  if (sentryDsn !== undefined) {
    initSentry({
      dsn: sentryDsn,
      environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
      serviceName: 'api-docs-hub',
    });
  }

  // Fail fast if required environment variables are missing
  const config = loadConfig();

  const app = await buildServer(config);

  // Log which OpenAPI URLs are loaded at startup using Fastify logger
  app.log.info('Starting api-docs-hub with OpenAPI sources:');
  for (const source of config.openApiSources) {
    app.log.info({ name: source.name, url: source.url }, 'OpenAPI source configured');
  }

  const close = (): void => {
    app.close().then(
      () => {
        process.exit(0);
      },
      () => {
        process.exit(1);
      }
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port: config.port, host: config.host });
}

main().catch(() => {
  process.exit(1);
});
