/**
 * Main orchestration for audio transcription.
 *
 * Handles the complete transcription workflow:
 * 1. Fetch user's transcription provider preference
 * 2. Generate GCS signed URL for audio file
 * 3. Create transcription provider
 * 4. Submit transcription job
 * 5. Poll until completion
 * 6. Fetch transcript text
 * 7. Publish TranscriptionCompletedEvent
 */
import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import { getErrorMessage } from '@intexuraos/common-core';
import type { AudioStoredEvent, TranscriptionCompletedEvent } from './types.js';
import type { SpeechTranscriptionPort } from './providers/transcription-provider.js';
import type { Logger } from './logger.js';
import { formatSpeechmaticsError } from './format-error.js';
import { pollUntilComplete, DEFAULT_POLL_CONFIG, type PollingConfig } from './polling.js';

/**
 * Dependencies for the transcription orchestrator.
 * All dependencies are injectable for testability.
 */
export interface TranscriptionDeps {
  /**
   * Fetch the user's transcription provider preference from user-service.
   * Returns provider name (e.g., 'speechmatics'). Defaults to 'speechmatics'.
   */
  fetchUserProvider: (userId: string) => Promise<string>;

  /**
   * Generate a signed GCS URL for audio file access.
   */
  generateSignedUrl: (gcsPath: string) => Promise<Result<string, { message: string }>>;

  /**
   * Create a transcription provider by name.
   */
  createProvider: (providerName: string) => SpeechTranscriptionPort;

  /**
   * Publish a TranscriptionCompletedEvent to Pub/Sub.
   */
  publishEvent: (event: TranscriptionCompletedEvent) => Promise<Result<void, PublishError>>;

  /**
   * Optional polling configuration override.
   */
  pollConfig?: Partial<PollingConfig>;

  /**
   * Optional sleep function (injectable for testing).
   */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Orchestrate audio transcription for an AudioStoredEvent.
 *
 * Handles all error cases internally and always publishes a
 * TranscriptionCompletedEvent with status 'completed' or 'failed'.
 *
 * @param event - The audio stored event from Pub/Sub
 * @param deps - Injected dependencies
 * @param logger - Logger for progress tracking
 */
export async function transcribeAudio(
  event: AudioStoredEvent,
  deps: TranscriptionDeps,
  logger: Logger
): Promise<void> {
  // mediaId is part of AudioStoredEvent for audit traceability in consuming services,
  // but is not needed for the transcription workflow itself (GCS path identifies the file).
  const { userId, messageId, gcsPath, mimeType } = event;

  logger.info(
    { event: 'transcription_start', userId, messageId, gcsPath },
    'Starting transcription worker'
  );

  const pollConfig = { ...DEFAULT_POLL_CONFIG, ...deps.pollConfig };

  try {
    // Step 1: Fetch user's provider preference
    logger.info({ event: 'fetch_provider', userId }, 'Fetching user transcription provider');
    const providerName = await deps.fetchUserProvider(userId);
    logger.info({ event: 'provider_resolved', userId, providerName }, 'Provider resolved');

    // Step 2: Generate signed URL for GCS audio file
    logger.info({ event: 'generate_signed_url', gcsPath }, 'Generating signed URL');
    const signedUrlResult = await deps.generateSignedUrl(gcsPath);

    if (!signedUrlResult.ok) {
      const errorMessage = signedUrlResult.error.message;
      logger.error(
        { event: 'signed_url_error', userId, messageId, gcsPath, error: errorMessage },
        'Failed to generate signed URL'
      );
      await publishFailed(deps, userId, messageId, 'unknown', errorMessage, logger);
      return;
    }

    const audioUrl = signedUrlResult.value;

    // Step 3: Create transcription provider
    const provider = deps.createProvider(providerName);

    // Step 4: Submit transcription job
    logger.info({ event: 'submit_job', userId, messageId }, 'Submitting transcription job');
    const submitResult = await provider.submitJob({ audioUrl, mimeType });

    if (!submitResult.ok) {
      const rawError = submitResult.error.message;
      const formattedError = formatSpeechmaticsError(rawError);
      logger.error(
        { event: 'submit_error', userId, messageId, error: rawError },
        'Failed to submit transcription job'
      );
      await publishFailed(deps, userId, messageId, 'unknown', formattedError, logger);
      return;
    }

    const jobId = submitResult.value.jobId;
    logger.info(
      { event: 'job_submitted', userId, messageId, jobId },
      'Transcription job submitted'
    );

    // Step 5: Poll until completion
    const pollResult = await pollUntilComplete(provider, jobId, pollConfig, logger, deps.sleep);

    if (pollResult.status === 'timeout') {
      logger.error(
        { event: 'poll_timeout', userId, messageId, jobId },
        'Transcription polling timed out'
      );
      await publishFailed(
        deps,
        userId,
        messageId,
        jobId,
        'Transcription polling timed out',
        logger
      );
      return;
    }

    if (pollResult.status === 'rejected') {
      const rawError = pollResult.error?.message ?? 'Job was rejected';
      const formattedError = formatSpeechmaticsError(rawError);
      logger.error(
        { event: 'job_rejected', userId, messageId, jobId, error: rawError },
        'Transcription job was rejected'
      );
      await publishFailed(deps, userId, messageId, jobId, formattedError, logger);
      return;
    }

    // Step 6: Fetch transcript
    logger.info({ event: 'fetch_transcript', userId, messageId, jobId }, 'Fetching transcript');
    const transcriptResult = await provider.getTranscript(jobId);

    if (!transcriptResult.ok) {
      const rawError = transcriptResult.error.message;
      const formattedError = formatSpeechmaticsError(rawError);
      logger.error(
        { event: 'transcript_error', userId, messageId, jobId, error: rawError },
        'Failed to fetch transcript'
      );
      await publishFailed(deps, userId, messageId, jobId, formattedError, logger);
      return;
    }

    const { text, summary, detectedLanguage } = transcriptResult.value;

    // Step 7: Publish success event
    const completedEvent: TranscriptionCompletedEvent = {
      type: 'srt.transcription.completed',
      userId,
      messageId,
      jobId,
      status: 'completed',
      transcript: text,
      timestamp: new Date().toISOString(),
    };
    if (summary !== undefined) {
      completedEvent.summary = summary;
    }
    if (detectedLanguage !== undefined) {
      completedEvent.detectedLanguage = detectedLanguage;
    }

    const publishResult = await deps.publishEvent(completedEvent);
    if (!publishResult.ok) {
      logger.error(
        { event: 'publish_error', userId, messageId, jobId, error: publishResult.error },
        'Failed to publish completed event'
      );
    } else {
      logger.info(
        {
          event: 'transcription_completed',
          userId,
          messageId,
          jobId,
          transcriptLength: text.length,
          hasSummary: summary !== undefined,
        },
        'Transcription completed successfully'
      );
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error(
      { event: 'unexpected_error', userId, messageId, error: errorMessage },
      'Unexpected error during transcription'
    );
    await publishFailed(deps, userId, messageId, 'unknown', errorMessage, logger);
  }
}

/**
 * Publish a failed TranscriptionCompletedEvent.
 */
async function publishFailed(
  deps: TranscriptionDeps,
  userId: string,
  messageId: string,
  jobId: string,
  errorMessage: string,
  logger: Logger
): Promise<void> {
  const failedEvent: TranscriptionCompletedEvent = {
    type: 'srt.transcription.completed',
    userId,
    messageId,
    jobId,
    status: 'failed',
    error: errorMessage,
    timestamp: new Date().toISOString(),
  };

  const publishResult = await deps.publishEvent(failedEvent);
  if (!publishResult.ok) {
    logger.error(
      { event: 'publish_failed_error', userId, messageId, error: publishResult.error },
      'Failed to publish failure event'
    );
  }
}
