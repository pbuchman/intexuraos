/**
 * Polling Worker.
 * Polls Speechmatics for job status updates on pending/processing jobs.
 * Uses exponential backoff per job.
 */
import type { ServiceContainer } from '../services.js';
import type { WorkerLogger } from './audioEventWorker.js';
import type { TranscriptionJob } from '../domain/transcription/index.js';

/**
 * Polling configuration.
 */
export interface PollingConfig {
  /** Interval between poll cycles in milliseconds. */
  pollCycleIntervalMs: number;
  /** Initial poll delay in milliseconds. */
  initialPollDelayMs: number;
  /** Maximum poll delay in milliseconds (1 hour). */
  maxPollDelayMs: number;
  /** Batch size for jobs to poll per cycle. */
  batchSize: number;
}

/**
 * Default polling configuration.
 */
export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  pollCycleIntervalMs: 1000, // 1 second between cycles
  initialPollDelayMs: 5000, // 5 seconds initial delay
  maxPollDelayMs: 3600000, // 1 hour max
  batchSize: 10,
};

/**
 * Calculate next poll delay using exponential backoff.
 * 5s → 10s → 20s → 40s → ... → max 1h
 */
export function calculateNextPollDelay(
  pollAttempts: number,
  config: PollingConfig = DEFAULT_POLLING_CONFIG
): number {
  const delay = config.initialPollDelayMs * Math.pow(2, pollAttempts);
  return Math.min(delay, config.maxPollDelayMs);
}

/**
 * Process a single pending job: submit to Speechmatics.
 */
async function processPendingJob(
  job: TranscriptionJob,
  services: ServiceContainer,
  logger: WorkerLogger
): Promise<void> {
  const { jobRepository, speechmaticsClient } = services;

  logger.info('Submitting job to Speechmatics', { jobId: job.id, gcsPath: job.gcsPath });

  // Create signed URL for audio file
  // Note: This would need a GCS client to generate signed URL
  // For now, we'll use the gcsPath directly (Speechmatics needs accessible URL)
  const audioUrl = job.gcsPath; // TODO: Generate signed URL

  const createResult = await speechmaticsClient.createJob(audioUrl);

  if (!createResult.ok) {
    logger.error('Failed to submit job to Speechmatics', {
      jobId: job.id,
      error: createResult.error.message,
    });

    // Update job with error
    await jobRepository.update(job.id, {
      status: 'failed',
      error: createResult.error.message,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  // Update job with Speechmatics job ID and set to processing
  const nextPollAt = new Date(Date.now() + DEFAULT_POLLING_CONFIG.initialPollDelayMs).toISOString();

  await jobRepository.update(job.id, {
    status: 'processing',
    speechmaticsJobId: createResult.value.id,
    nextPollAt,
    pollAttempts: 0,
    updatedAt: new Date().toISOString(),
  });

  logger.info('Job submitted to Speechmatics', {
    jobId: job.id,
    speechmaticsJobId: createResult.value.id,
  });
}

/**
 * Poll a single processing job for status.
 */
async function pollProcessingJob(
  job: TranscriptionJob,
  services: ServiceContainer,
  logger: WorkerLogger
): Promise<void> {
  const { jobRepository, speechmaticsClient } = services;

  if (job.speechmaticsJobId === undefined) {
    logger.error('Processing job missing Speechmatics job ID', { jobId: job.id });
    return;
  }

  const statusResult = await speechmaticsClient.getJobStatus(job.speechmaticsJobId);

  if (!statusResult.ok) {
    logger.error('Failed to get job status from Speechmatics', {
      jobId: job.id,
      speechmaticsJobId: job.speechmaticsJobId,
      error: statusResult.error.message,
    });

    // Calculate next poll with backoff
    const nextPollDelay = calculateNextPollDelay(job.pollAttempts + 1);
    const nextPollAt = new Date(Date.now() + nextPollDelay).toISOString();

    await jobRepository.update(job.id, {
      pollAttempts: job.pollAttempts + 1,
      nextPollAt,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const status = statusResult.value;

  logger.info('Got Speechmatics job status', {
    jobId: job.id,
    speechmaticsJobId: job.speechmaticsJobId,
    speechmaticsStatus: status.status,
  });

  switch (status.status) {
    case 'done': {
      // Job completed successfully
      const now = new Date().toISOString();
      const updates: Parameters<typeof jobRepository.update>[1] = {
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      };
      if (status.transcript !== undefined) {
        updates.transcript = status.transcript;
      }
      await jobRepository.update(job.id, updates);
      logger.info('Job completed', { jobId: job.id });
      break;
    }

    case 'rejected': {
      // Job failed
      await jobRepository.update(job.id, {
        status: 'failed',
        error: status.error ?? 'Job rejected by Speechmatics',
        updatedAt: new Date().toISOString(),
      });
      logger.error('Job rejected', { jobId: job.id, error: status.error });
      break;
    }

    case 'deleted': {
      // Job was deleted
      await jobRepository.update(job.id, {
        status: 'failed',
        error: 'Job deleted from Speechmatics',
        updatedAt: new Date().toISOString(),
      });
      logger.error('Job deleted', { jobId: job.id });
      break;
    }

    case 'accepted':
    case 'running': {
      // Job still in progress, schedule next poll with backoff
      const nextPollDelay = calculateNextPollDelay(job.pollAttempts + 1);
      const nextPollAt = new Date(Date.now() + nextPollDelay).toISOString();

      await jobRepository.update(job.id, {
        pollAttempts: job.pollAttempts + 1,
        nextPollAt,
        updatedAt: new Date().toISOString(),
      });
      break;
    }
  }
}

/**
 * Run a single poll cycle.
 */
async function runPollCycle(
  services: ServiceContainer,
  logger: WorkerLogger,
  config: PollingConfig
): Promise<void> {
  const { jobRepository } = services;

  // Process pending jobs (submit to Speechmatics)
  const pendingResult = await jobRepository.getPendingJobs(config.batchSize);

  if (pendingResult.ok && pendingResult.value.length > 0) {
    logger.info('Processing pending jobs', { count: pendingResult.value.length });

    for (const job of pendingResult.value) {
      await processPendingJob(job, services, logger);
    }
  }

  // Poll processing jobs
  const processingResult = await jobRepository.getJobsReadyToPoll(config.batchSize);

  if (processingResult.ok && processingResult.value.length > 0) {
    logger.info('Polling processing jobs', { count: processingResult.value.length });

    for (const job of processingResult.value) {
      await pollProcessingJob(job, services, logger);
    }
  }
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start the polling worker.
 * Returns a stop function to gracefully shut down the worker.
 */
export function startPollingWorker(
  services: ServiceContainer,
  logger: WorkerLogger,
  config: PollingConfig = DEFAULT_POLLING_CONFIG
): () => void {
  let running = true;

  const runLoop = async (): Promise<void> => {
    logger.info('Polling worker started');

    while (running) {
      try {
        await runPollCycle(services, logger, config);
      } catch (error) {
        logger.error('Poll cycle error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Running can be changed externally by stop function
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (running) {
        await sleep(config.pollCycleIntervalMs);
      }
    }

    logger.info('Polling worker stopped');
  };

  // Start the loop (fire and forget)
  void runLoop();

  // Return stop function
  return (): void => {
    running = false;
  };
}
