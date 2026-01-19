/**
 * Use case for transcribing audio messages.
 *
 * Handles the complete transcription workflow:
 * 1. Get signed URL for audio file
 * 2. Submit job to transcription service
 * 3. Poll until completion
 * 4. Fetch transcript
 * 5. Update message with transcription
 * 6. Send result to user via WhatsApp
 *
 * IMPORTANT: Cloud Run Considerations
 * This use case runs in the background after the webhook returns 200.
 * Risks:
 * - Container may be killed before transcription completes
 * - Long audio files (>5 min) are at higher risk
 * - Consider setting min_scale=1 for whatsapp-service for reliability
 *
 * Future improvement: Use Cloud Tasks for guaranteed delivery.
 */
import type { TranscriptionState } from '../models/WhatsAppMessage.js';
import type { WhatsAppMessageRepository } from '../ports/repositories.js';
import type { MediaStoragePort } from '../ports/mediaStorage.js';
import type { SpeechTranscriptionPort } from '../ports/transcription.js';
import type { WhatsAppCloudApiPort } from '../ports/whatsappCloudApi.js';
import type { EventPublisherPort } from '../ports/eventPublisher.js';
import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from '../utils/logger.js';
import { formatSpeechmaticsError } from '../formatSpeechmaticsError.js';

/**
 * Input for transcribing an audio message.
 */
export interface TranscribeAudioInput {
  messageId: string;
  userId: string;
  gcsPath: string;
  mimeType: string;
  userPhoneNumber: string;
  originalWaMessageId: string;
  phoneNumberId: string;
}

/**
 * Configuration for transcription polling.
 */
export interface TranscriptionPollingConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  maxAttempts: number;
}

/**
 * Default polling configuration.
 */
export const DEFAULT_TRANSCRIPTION_POLL_CONFIG: TranscriptionPollingConfig = {
  initialDelayMs: 2000,
  maxDelayMs: 30000,
  backoffMultiplier: 1.5,
  maxAttempts: 60, // ~5 minutes max with backoff
};

/**
 * Logger for the use case.
 */
export type TranscribeAudioLogger = Logger;

/**
 * Dependencies for TranscribeAudioUseCase.
 */
export interface TranscribeAudioDeps {
  messageRepository: WhatsAppMessageRepository;
  mediaStorage: MediaStoragePort;
  transcriptionService: SpeechTranscriptionPort;
  whatsappCloudApi: WhatsAppCloudApiPort;
  eventPublisher?: EventPublisherPort;
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Use case for transcribing audio messages.
 */
export class TranscribeAudioUseCase {
  private readonly pollingConfig: TranscriptionPollingConfig;

  constructor(
    private readonly deps: TranscribeAudioDeps,
    pollingConfig?: Partial<TranscriptionPollingConfig>
  ) {
    this.pollingConfig = { ...DEFAULT_TRANSCRIPTION_POLL_CONFIG, ...pollingConfig };
  }

  /**
   * Execute the transcription workflow.
   *
   * This method is designed to be called fire-and-forget (void return).
   * All errors are handled internally and reported to the user via WhatsApp.
   *
   * @param input - Audio message details
   * @param logger - Logger for tracking progress
   */
  async execute(input: TranscribeAudioInput, logger: TranscribeAudioLogger): Promise<void> {
    const { messageRepository, mediaStorage, transcriptionService, whatsappCloudApi } = this.deps;

    const {
      messageId,
      userId,
      gcsPath,
      mimeType,
      userPhoneNumber,
      originalWaMessageId,
      phoneNumberId,
    } = input;
    const startedAt = new Date().toISOString();

    logger.info(
      { event: 'transcription_start', messageId, userId, gcsPath },
      'Starting in-process audio transcription'
    );

    // Initialize transcription state as pending
    const initialState: TranscriptionState = {
      status: 'pending',
      startedAt,
    };
    await messageRepository.updateTranscription(userId, messageId, initialState);

    try {
      // Step 1: Get signed URL for audio file
      logger.info(
        { event: 'transcription_get_signed_url', messageId },
        'Getting signed URL for audio file'
      );

      const signedUrlResult = await mediaStorage.getSignedUrl(gcsPath, 3600); // 1 hour expiry
      if (!signedUrlResult.ok) {
        const errorState: TranscriptionState = {
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          error: {
            code: 'SIGNED_URL_ERROR',
            message: signedUrlResult.error.message,
          },
        };
        await messageRepository.updateTranscription(userId, messageId, errorState);
        await this.sendFailureMessage(
          whatsappCloudApi,
          phoneNumberId,
          userPhoneNumber,
          originalWaMessageId,
          'Failed to access audio file'
        );
        logger.error(
          { event: 'transcription_signed_url_error', messageId, error: signedUrlResult.error },
          'Failed to get signed URL'
        );
        return;
      }

      // Step 2: Submit job to transcription service
      logger.info({ event: 'transcription_submit', messageId }, 'Submitting transcription job');

      const submitResult = await transcriptionService.submitJob({
        audioUrl: signedUrlResult.value,
        mimeType,
      });

      if (!submitResult.ok) {
        const rawError = submitResult.error.message;
        const formattedMessage = formatSpeechmaticsError(rawError);

        // Log full error context for debugging
        logger.error(
          {
            event: 'transcription_submit_error_raw',
            messageId,
            rawError,
            errorCode: submitResult.error.code,
            ...(submitResult.error.apiCall !== undefined && { apiCall: submitResult.error.apiCall }),
          },
          'Speechmatics submit error with full context'
        );

        const errorState: TranscriptionState = {
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          error: {
            code: submitResult.error.code,
            message: formattedMessage,
          },
        };
        if (submitResult.error.apiCall !== undefined) {
          errorState.lastApiCall = submitResult.error.apiCall;
        }
        await messageRepository.updateTranscription(userId, messageId, errorState);
        await this.sendFailureMessage(
          whatsappCloudApi,
          phoneNumberId,
          userPhoneNumber,
          originalWaMessageId,
          `Transcription submission failed: ${formattedMessage}`
        );
        logger.error(
          { event: 'transcription_submit_error', messageId, error: submitResult.error },
          'Failed to submit transcription job'
        );
        return;
      }

      const jobId = submitResult.value.jobId;

      // Update state to processing
      const processingState: TranscriptionState = {
        status: 'processing',
        jobId,
        startedAt,
        lastApiCall: submitResult.value.apiCall,
      };
      await messageRepository.updateTranscription(userId, messageId, processingState);

      logger.info(
        { event: 'transcription_submitted', messageId, jobId },
        'Transcription job submitted, starting poll'
      );

      // Step 3: Poll until completion
      const pollResult = await this.pollUntilComplete(
        transcriptionService,
        jobId,
        messageId,
        logger
      );

      if (pollResult.status === 'timeout') {
        const errorState: TranscriptionState = {
          status: 'failed',
          jobId,
          startedAt,
          completedAt: new Date().toISOString(),
          error: { code: 'POLL_TIMEOUT', message: 'Transcription polling timed out' },
        };
        if (pollResult.lastApiCall !== undefined) {
          errorState.lastApiCall = pollResult.lastApiCall;
        }
        await messageRepository.updateTranscription(userId, messageId, errorState);
        await this.sendFailureMessage(
          whatsappCloudApi,
          phoneNumberId,
          userPhoneNumber,
          originalWaMessageId,
          'Transcription timed out'
        );
        logger.error(
          { event: 'transcription_timeout', messageId, jobId },
          'Transcription polling timed out'
        );
        return;
      }

      if (pollResult.status === 'rejected') {
        const rawError = pollResult.error?.message ?? 'Job was rejected';
        const formattedMessage = formatSpeechmaticsError(rawError);

        // Log full error context for debugging
        logger.error(
          {
            event: 'transcription_rejected_raw',
            messageId,
            jobId,
            rawError,
            errorCode: pollResult.error?.code,
            lastApiCall: pollResult.lastApiCall,
          },
          'Speechmatics job rejection with full context'
        );

        const errorState: TranscriptionState = {
          status: 'failed',
          jobId,
          startedAt,
          completedAt: new Date().toISOString(),
          error: {
            code: pollResult.error?.code ?? 'JOB_REJECTED',
            message: formattedMessage,
          },
        };
        if (pollResult.lastApiCall !== undefined) {
          errorState.lastApiCall = pollResult.lastApiCall;
        }
        await messageRepository.updateTranscription(userId, messageId, errorState);
        await this.sendFailureMessage(
          whatsappCloudApi,
          phoneNumberId,
          userPhoneNumber,
          originalWaMessageId,
          `Transcription failed: ${formattedMessage}`
        );
        logger.error(
          { event: 'transcription_rejected', messageId, jobId, error: pollResult.error },
          'Transcription job was rejected'
        );
        return;
      }

      logger.info({ event: 'transcription_done', messageId, jobId }, 'Transcription job completed');

      // Step 4: Fetch transcript
      logger.info(
        { event: 'transcription_fetch', messageId, jobId },
        'Fetching transcription result'
      );

      const transcriptResult = await transcriptionService.getTranscript(jobId);

      if (!transcriptResult.ok) {
        const rawError = transcriptResult.error.message;
        const formattedMessage = formatSpeechmaticsError(rawError);

        // Log full error context for debugging
        logger.error(
          {
            event: 'transcription_fetch_error_raw',
            messageId,
            jobId,
            rawError,
            errorCode: transcriptResult.error.code,
            ...(transcriptResult.error.apiCall !== undefined && { apiCall: transcriptResult.error.apiCall }),
          },
          'Speechmatics fetch error with full context'
        );

        const errorState: TranscriptionState = {
          status: 'failed',
          jobId,
          startedAt,
          completedAt: new Date().toISOString(),
          error: {
            code: transcriptResult.error.code,
            message: formattedMessage,
          },
        };
        if (transcriptResult.error.apiCall !== undefined) {
          errorState.lastApiCall = transcriptResult.error.apiCall;
        }
        await messageRepository.updateTranscription(userId, messageId, errorState);
        await this.sendFailureMessage(
          whatsappCloudApi,
          phoneNumberId,
          userPhoneNumber,
          originalWaMessageId,
          `Failed to fetch transcript: ${formattedMessage}`
        );
        logger.error(
          { event: 'transcription_fetch_error', messageId, jobId, error: transcriptResult.error },
          'Failed to fetch transcription result'
        );
        return;
      }

      const transcript = transcriptResult.value.text;
      const summary = transcriptResult.value.summary;

      // Step 5: Update message with completed transcription
      const completedState: TranscriptionState = {
        status: 'completed',
        jobId,
        text: transcript,
        ...(summary !== undefined && { summary }),
        startedAt,
        completedAt: new Date().toISOString(),
        lastApiCall: transcriptResult.value.apiCall,
      };
      await messageRepository.updateTranscription(userId, messageId, completedState);

      logger.info(
        {
          event: 'transcription_completed',
          messageId,
          jobId,
          transcriptLength: transcript.length,
          hasSummary: summary !== undefined,
        },
        'Transcription completed successfully'
      );

      // Step 6: Publish command ingest event for voice message
      if (this.deps.eventPublisher !== undefined) {
        const publishResult = await this.deps.eventPublisher.publishCommandIngest({
          type: 'command.ingest',
          userId,
          sourceType: 'whatsapp_voice',
          externalId: originalWaMessageId,
          text: transcript,
          ...(summary !== undefined && { summary }),
          timestamp: startedAt,
        });

        if (publishResult.ok) {
          logger.info(
            { event: 'command_ingest_published', messageId, userId },
            'Published command ingest event for voice message'
          );
        } else {
          logger.error(
            { event: 'command_ingest_publish_failed', messageId, error: publishResult.error },
            'Failed to publish command ingest event'
          );
        }
      }

      // Step 7: Send transcript to user via WhatsApp
      await this.sendSuccessMessage(
        whatsappCloudApi,
        phoneNumberId,
        userPhoneNumber,
        originalWaMessageId,
        transcript,
        summary
      );
    } catch (error) {
      // Log raw error for debugging
      logger.error(
        { event: 'transcription_unexpected_error_raw', messageId, error },
        'Raw unexpected error during transcription'
      );

      const errorMessage = getErrorMessage(error);
      const errorState: TranscriptionState = {
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        error: { code: 'UNEXPECTED_ERROR', message: errorMessage },
      };
      await messageRepository.updateTranscription(userId, messageId, errorState);
      await this.sendFailureMessage(
        whatsappCloudApi,
        phoneNumberId,
        userPhoneNumber,
        originalWaMessageId,
        `Unexpected error: ${errorMessage}`
      );
      logger.error(
        { event: 'transcription_unexpected_error', messageId, error: errorMessage },
        'Unexpected error during transcription'
      );
    }
  }

  /**
   * Poll transcription job until completion, timeout, or rejection.
   */
  private async pollUntilComplete(
    transcriptionService: SpeechTranscriptionPort,
    jobId: string,
    messageId: string,
    logger: TranscribeAudioLogger
  ): Promise<PollResult> {
    let delayMs = this.pollingConfig.initialDelayMs;
    let attempts = 0;
    let lastApiCall: TranscriptionState['lastApiCall'];

    while (attempts < this.pollingConfig.maxAttempts) {
      attempts++;
      await sleep(delayMs);

      logger.info(
        { event: 'transcription_poll', messageId, jobId, attempt: attempts, delayMs },
        'Polling transcription job status'
      );

      const pollResult = await transcriptionService.pollJob(jobId);

      if (!pollResult.ok) {
        logger.error(
          { event: 'transcription_poll_error', messageId, jobId, error: pollResult.error },
          'Failed to poll transcription status'
        );
        // Continue polling on transient errors
        delayMs = Math.min(
          delayMs * this.pollingConfig.backoffMultiplier,
          this.pollingConfig.maxDelayMs
        );
        continue;
      }

      lastApiCall = pollResult.value.apiCall;

      if (pollResult.value.status === 'done') {
        return { status: 'done', lastApiCall };
      }

      if (pollResult.value.status === 'rejected') {
        const result: PollResult = {
          status: 'rejected',
          lastApiCall,
        };
        if (pollResult.value.error !== undefined) {
          result.error = pollResult.value.error;
        }
        return result;
      }

      // Exponential backoff
      delayMs = Math.min(
        delayMs * this.pollingConfig.backoffMultiplier,
        this.pollingConfig.maxDelayMs
      );
    }

    return { status: 'timeout', lastApiCall };
  }

  /**
   * Send transcription success message to user.
   */
  private async sendSuccessMessage(
    whatsappCloudApi: WhatsAppCloudApiPort,
    phoneNumberId: string,
    userPhoneNumber: string,
    originalWaMessageId: string,
    transcript: string,
    summary?: string
  ): Promise<void> {
    let message = `🎙️ *Transcription:*\n\n${transcript}`;
    if (summary !== undefined) {
      message += `\n\n📝 *Summary:*\n\n${summary}`;
    }
    await whatsappCloudApi.sendMessage(
      phoneNumberId,
      userPhoneNumber,
      message,
      originalWaMessageId
    );
  }

  /**
   * Send transcription failure message to user.
   */
  private async sendFailureMessage(
    whatsappCloudApi: WhatsAppCloudApiPort,
    phoneNumberId: string,
    userPhoneNumber: string,
    originalWaMessageId: string,
    errorDetails: string
  ): Promise<void> {
    const message = `❌ *Transcription failed:*\n\n${errorDetails}`;
    await whatsappCloudApi.sendMessage(
      phoneNumberId,
      userPhoneNumber,
      message,
      originalWaMessageId
    );
  }
}

/**
 * Internal result type for polling.
 */
type PollResult =
  | { status: 'done'; lastApiCall?: TranscriptionState['lastApiCall'] }
  | {
      status: 'rejected';
      error?: { code: string; message: string };
      lastApiCall?: TranscriptionState['lastApiCall'];
    }
  | { status: 'timeout'; lastApiCall?: TranscriptionState['lastApiCall'] };
