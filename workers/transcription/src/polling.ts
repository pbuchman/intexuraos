/**
 * Polling logic for transcription jobs.
 *
 * Polls a transcription provider until the job completes, fails, or times out.
 * Uses exponential backoff between polls.
 */
import type { SpeechTranscriptionPort } from './providers/transcription-provider.js';
import type { Logger } from './logger.js';

/**
 * Configuration for polling behavior.
 */
export interface PollingConfig {
  /** Initial delay between polls in milliseconds. */
  initialDelayMs: number;
  /** Maximum delay between polls in milliseconds. */
  maxDelayMs: number;
  /** Multiplier applied to delay on each attempt. */
  backoffMultiplier: number;
  /** Maximum number of polling attempts before timeout. */
  maxAttempts: number;
}

/**
 * Default polling configuration.
 * Provides up to ~5 minutes of polling with exponential backoff.
 */
export const DEFAULT_POLL_CONFIG: PollingConfig = {
  initialDelayMs: 2000,
  maxDelayMs: 30000,
  backoffMultiplier: 1.5,
  maxAttempts: 60,
};

/**
 * Result from polling a transcription job.
 */
export type PollResult =
  | { status: 'done' }
  | { status: 'rejected'; error?: { code: string; message: string } }
  | { status: 'timeout' };

/**
 * Sleep for a given number of milliseconds.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a transcription job until it completes, is rejected, or times out.
 *
 * @param provider - The transcription provider to poll
 * @param jobId - Provider-specific job ID
 * @param config - Polling configuration
 * @param logger - Logger for progress tracking
 * @param sleep - Optional sleep function (injectable for testing)
 * @returns Poll result indicating done, rejected, or timeout
 */
export async function pollUntilComplete(
  provider: SpeechTranscriptionPort,
  jobId: string,
  config: PollingConfig,
  logger: Logger,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<PollResult> {
  let delayMs = config.initialDelayMs;
  let attempts = 0;

  while (attempts < config.maxAttempts) {
    attempts++;
    await sleep(delayMs);

    logger.info(
      { event: 'transcription_poll', jobId, attempt: attempts, delayMs },
      'Polling transcription job status'
    );

    const pollResult = await provider.pollJob(jobId);

    if (!pollResult.ok) {
      logger.error(
        { event: 'transcription_poll_error', jobId, error: pollResult.error },
        'Failed to poll transcription status'
      );
      // Continue polling on transient errors
      delayMs = Math.min(delayMs * config.backoffMultiplier, config.maxDelayMs);
      continue;
    }

    if (pollResult.value.status === 'done') {
      logger.info(
        { event: 'transcription_poll_done', jobId, attempts },
        'Transcription job completed'
      );
      return { status: 'done' };
    }

    if (pollResult.value.status === 'rejected') {
      logger.warn(
        { event: 'transcription_poll_rejected', jobId, error: pollResult.value.error },
        'Transcription job rejected'
      );
      const result: PollResult = { status: 'rejected' };
      if (pollResult.value.error !== undefined) {
        result.error = pollResult.value.error;
      }
      return result;
    }

    // Job is still running, apply backoff
    delayMs = Math.min(delayMs * config.backoffMultiplier, config.maxDelayMs);
  }

  logger.error(
    { event: 'transcription_poll_timeout', jobId, attempts },
    'Transcription polling timed out'
  );

  return { status: 'timeout' };
}
