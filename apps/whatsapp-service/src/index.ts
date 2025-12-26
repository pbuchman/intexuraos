import pino from 'pino';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import {
  createCleanupWorker,
  TranscriptionWorker,
  type CleanupWorker,
  type CleanupWorkerLogger,
} from './workers/index.js';
import { initServices, getServices } from './services.js';

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
    audioStoredTopic: config.audioStoredTopic,
    mediaCleanupTopic: config.mediaCleanupTopic,
    whatsappAccessToken: config.accessToken,
    whatsappPhoneNumberId: config.allowedPhoneNumberIds[0] ?? '',
  });

  const app = await buildServer(config);

  // Start workers (cleanup and transcription)
  let cleanupWorker: CleanupWorker | null = null;
  let transcriptionWorker: TranscriptionWorker | null = null;

  // Only start workers in non-test environment
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] === undefined) {
    const services = getServices();

    // Cleanup worker for media deletion events
    cleanupWorker = createCleanupWorker(
      {
        projectId: config.gcpProjectId,
        subscriptionName: config.mediaCleanupSubscription,
      },
      services.mediaStorage,
      createWorkerLogger('CleanupWorker')
    );
    cleanupWorker.start();

    // Transcription worker for transcription completed events
    transcriptionWorker = new TranscriptionWorker(
      config.gcpProjectId,
      config.transcriptionCompletedSubscription,
      services.messageRepository,
      services.messageSender,
      createWorkerLogger('TranscriptionWorker')
    );
    transcriptionWorker.start();
  }

  const close = (): void => {
    // Stop workers first
    transcriptionWorker?.stop();
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
  process.stderr.write(
    `Failed to start server: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
