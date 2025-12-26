/**
 * SRT Service entry point.
 * Speech Recognition/Transcription via Speechmatics Batch API.
 */
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { initServices, getServices } from './services.js';
import { startAudioEventWorker, startPollingWorker } from './workers/index.js';
import type { WorkerLogger } from './workers/index.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Initialize services with config
  initServices({
    speechmaticsApiKey: config.speechmaticsApiKey,
    gcpProjectId: config.gcpProjectId,
    audioStoredSubscription: config.audioStoredSubscription,
    transcriptionCompletedTopic: config.transcriptionCompletedTopic,
    mediaBucketName: config.mediaBucketName,
  });

  const server = await createServer(config);

  try {
    await server.listen({ port: config.port, host: config.host });
    server.log.info(`SRT Service listening on ${config.host}:${String(config.port)}`);

    // Start audio event worker (only in production, not in tests)
    if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] === undefined) {
      const workerLogger: WorkerLogger = {
        info: (message, data): void => {
          server.log.info(data ?? {}, message);
        },
        error: (message, data): void => {
          server.log.error(data ?? {}, message);
        },
      };

      const stopWorker = startAudioEventWorker(getServices(), workerLogger);
      const stopPoller = startPollingWorker(getServices(), workerLogger);

      // Handle graceful shutdown
      const shutdown = (): void => {
        server.log.info('Shutting down...');
        stopWorker();
        stopPoller();
        void server.close().then(() => {
          process.exit(0);
        });
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    }
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

void main();
