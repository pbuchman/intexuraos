import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { getErrorMessage } from '@intexuraos/common';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

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

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error)}\n`);
  process.exit(1);
});
