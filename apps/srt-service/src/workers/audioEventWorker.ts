/**
 * Audio Event Worker.
 * Processes audio stored events from Pub/Sub and creates transcription jobs.
 */
import type { AudioStoredEvent, AudioStoredHandler } from '../infra/pubsub/subscriber.js';
import type { ServiceContainer } from '../services.js';

/**
 * Logger interface for worker logging.
 */
export interface WorkerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Creates an audio event handler for the worker.
 * This handler processes AudioStoredEvent messages and creates transcription jobs.
 */
export function createAudioEventHandler(
  services: ServiceContainer,
  logger: WorkerLogger
): AudioStoredHandler {
  return async (event: AudioStoredEvent): Promise<void> => {
    logger.info('Processing audio stored event', {
      messageId: event.messageId,
      mediaId: event.mediaId,
      userId: event.userId,
    });

    const { jobRepository } = services;

    // Check for existing job (idempotency)
    const existingResult = await jobRepository.findByMediaKey(event.messageId, event.mediaId);

    if (!existingResult.ok) {
      // Repository error - throw to trigger nack and retry
      throw new Error(`Failed to check existing job: ${existingResult.error.message}`);
    }

    if (existingResult.value !== null) {
      // Job already exists - this is idempotent, just log and return
      logger.info('Job already exists for audio', {
        jobId: existingResult.value.id,
        messageId: event.messageId,
        mediaId: event.mediaId,
      });
      return;
    }

    // Create new job
    const now = new Date().toISOString();
    const createResult = await jobRepository.create({
      messageId: event.messageId,
      mediaId: event.mediaId,
      userId: event.userId,
      gcsPath: event.gcsPath,
      mimeType: event.mimeType,
      status: 'pending',
      pollAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    if (!createResult.ok) {
      // Repository error - throw to trigger nack and retry
      throw new Error(`Failed to create job: ${createResult.error.message}`);
    }

    logger.info('Created transcription job', {
      jobId: createResult.value.id,
      messageId: event.messageId,
      mediaId: event.mediaId,
    });
  };
}

/**
 * Starts the audio event worker.
 * Initializes the subscriber and begins processing messages.
 */
export function startAudioEventWorker(
  services: ServiceContainer,
  logger: WorkerLogger
): () => void {
  const { audioStoredSubscriber } = services;
  const handler = createAudioEventHandler(services, logger);

  audioStoredSubscriber.setHandler(handler);
  audioStoredSubscriber.start();

  logger.info('Audio event worker started');

  // Return stop function
  return (): void => {
    audioStoredSubscriber.stop();
    logger.info('Audio event worker stopped');
  };
}
