import pino from 'pino';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import {
  createCleanupWorker,
  type CleanupWorker,
  type CleanupWorkerLogger,
} from './workers/index.js';
import { getServices } from './services.js';

/**
 * Create a logger for the cleanup worker using pino.
 */
function createWorkerLogger(): CleanupWorkerLogger {
  const logger = pino({ name: 'CleanupWorker' });
  return {
    info: (msg: string, data?: Record<string, unknown>): void => {
      logger.info(data ?? {}, msg);
    },
    warn: (msg: string, data?: Record<string, unknown>): void => {
      logger.warn(data ?? {}, msg);
    },
    error: (msg: string, data?: Record<string, unknown>): void => {
      logger.error(data ?? {}, msg);
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  // Start cleanup worker for media deletion events
  let cleanupWorker: CleanupWorker | null = null;

  // Only start worker in non-test environment
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] === undefined) {
    cleanupWorker = createCleanupWorker(
      {
        projectId: config.gcpProjectId,
        subscriptionName: config.mediaCleanupSubscription,
      },
      getServices().mediaStorage,
      createWorkerLogger()
    );
    cleanupWorker.start();
  }

  const close = (): void => {
    // Stop cleanup worker first
    const stopWorker = cleanupWorker !== null ? cleanupWorker.stop() : Promise.resolve();

    stopWorker
      .then(() => app.close())
      .then(
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
  process.stderr.write(
    `Failed to start server: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
