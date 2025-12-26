/**
 * Audio Event Worker.
 * Processes audio stored events from Pub/Sub and creates transcription jobs.
 * Immediately submits jobs to Speechmatics (no polling needed for initial submission).
 */
import type { AudioStoredEvent, AudioStoredHandler } from '../infra/pubsub/subscriber.js';
import type { ServiceContainer } from '../services.js';
import { DEFAULT_POLLING_CONFIG } from './pollingWorker.js';

/**
 * Logger interface for worker logging.
 */
export interface WorkerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Creates an audio event handler for the worker.
 * This handler processes AudioStoredEvent messages, creates transcription jobs,
 * and immediately submits them to Speechmatics.
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

    const { jobRepository, speechmaticsClient, audioStorage } = services;

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
        status: existingResult.value.status,
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

    const job = createResult.value;
    logger.info('Created transcription job', {
      jobId: job.id,
      messageId: event.messageId,
      mediaId: event.mediaId,
    });

    // Immediately submit to Speechmatics (don't wait for polling worker)
    logger.info('Generating signed URL for audio', {
      jobId: job.id,
      gcsPath: event.gcsPath,
    });

    const signedUrlResult = await audioStorage.getSignedUrl(event.gcsPath, 3600);

    if (!signedUrlResult.ok) {
      logger.error('Failed to generate signed URL for audio', {
        jobId: job.id,
        gcsPath: event.gcsPath,
        error: signedUrlResult.error.message,
      });

      // Update job with error
      await jobRepository.update(job.id, {
        status: 'failed',
        error: `Failed to generate audio URL: ${signedUrlResult.error.message}`,
        updatedAt: new Date().toISOString(),
      });

      // Don't throw - job is created, just failed
      return;
    }

    const audioUrl = signedUrlResult.value;
    logger.info('Generated signed URL, submitting to Speechmatics', {
      jobId: job.id,
    });

    const submitResult = await speechmaticsClient.createJob(audioUrl);

    if (!submitResult.ok) {
      logger.error('Failed to submit job to Speechmatics', {
        jobId: job.id,
        error: submitResult.error.message,
      });

      // Update job with error
      await jobRepository.update(job.id, {
        status: 'failed',
        error: submitResult.error.message,
        updatedAt: new Date().toISOString(),
      });

      // Don't throw - job is created, just failed
      return;
    }

    // Update job with Speechmatics job ID and set to processing
    const nextPollAt = new Date(
      Date.now() + DEFAULT_POLLING_CONFIG.initialPollDelayMs
    ).toISOString();

    await jobRepository.update(job.id, {
      status: 'processing',
      speechmaticsJobId: submitResult.value.id,
      nextPollAt,
      pollAttempts: 0,
      updatedAt: new Date().toISOString(),
    });

    logger.info('Job submitted to Speechmatics successfully', {
      jobId: job.id,
      speechmaticsJobId: submitResult.value.id,
      nextPollAt,
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
