/**
 * SRT Service entry point.
 * Speech Recognition/Transcription via Speechmatics Batch API.
 *
 * Architecture:
 * - Receives HTTP requests to create/submit transcription jobs
 * - Polls Speechmatics for job completion via HTTP endpoint (called by Cloud Scheduler)
 * - Publishes completion events to Pub/Sub for whatsapp-service to consume
 * - Does NOT listen to any Pub/Sub topics (cost optimization)
 */
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { initServices } from './services.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Initialize services with config
  initServices({
    speechmaticsApiKey: config.speechmaticsApiKey,
    gcpProjectId: config.gcpProjectId,
    transcriptionCompletedTopic: config.transcriptionCompletedTopic,
    mediaBucketName: config.mediaBucketName,
  });

  const server = await createServer(config);

  try {
    await server.listen({ port: config.port, host: config.host });
    server.log.info(`SRT Service listening on ${config.host}:${String(config.port)}`);

    // Handle graceful shutdown
    const shutdown = (): void => {
      server.log.info('Shutting down...');
      void server.close().then(() => {
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

void main();
