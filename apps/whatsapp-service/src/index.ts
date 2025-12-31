import pino from 'pino';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import {
  type CleanupWorker,
  type CleanupWorkerLogger,
  createCleanupWorker,
} from './workers/index.js';
import { getServices, initServices } from './services.js';

/**
 * Create a logger for workers using pino.
 */
function createWorkerLogger(name: string): CleanupWorkerLogger {
  const logger = pino({ name });
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

  // Initialize services with config
  initServices({
    mediaBucket: config.mediaBucket,
    gcpProjectId: config.gcpProjectId,
    mediaCleanupTopic: config.mediaCleanupTopic,
    whatsappAccessToken: config.accessToken,
    whatsappPhoneNumberId: config.allowedPhoneNumberIds[0] ?? '',
    speechmaticsApiKey: config.speechmaticsApiKey,
  });

  const app = await buildServer(config);

  // Start workers (cleanup only - transcription is now in-process)
  let cleanupWorker: CleanupWorker | null = null;

  // Only start workers in non-test environment
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] === undefined) {
    const services = getServices();

    // Cleanup worker for media deletion events
    cleanupWorker = createCleanupWorker(
      {
        projectId: config.gcpProjectId,
        topicName: config.mediaCleanupTopic,
        subscriptionName: config.mediaCleanupSubscription,
      },
      services.mediaStorage,
      createWorkerLogger('CleanupWorker')
    );
    await cleanupWorker.start();
  }

  const close = (): void => {
    // Stop workers first
    const stopCleanupWorker = cleanupWorker !== null ? cleanupWorker.stop() : Promise.resolve();

    stopCleanupWorker
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
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
