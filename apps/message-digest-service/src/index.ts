import { getErrorMessage } from '@intexuraos/common-core';
import { initSentry } from '@intexuraos/infra-sentry';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const config = loadConfig();

initSentry({
  serviceName: 'message-digest-service',
  environment: config.environment,
  ...(config.sentryDsn === undefined ? {} : { dsn: config.sentryDsn }),
});

async function main(): Promise<void> {
  initServices(config);
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
  process.stderr.write(
    `Failed to start message-digest-service: ${getErrorMessage(error, String(error))}\n`
  );
  process.exit(1);
});
