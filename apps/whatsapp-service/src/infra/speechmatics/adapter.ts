/**
 * Speechmatics Batch API adapter.
 *
 * Implements SpeechTranscriptionPort using @speechmatics/batch-client.
 *
 * ## Cloud Run Considerations
 *
 * This adapter is designed for in-process async transcription in Cloud Run.
 * Risks documented in docs/architecture/transcription.md:
 * - Container may be killed before transcription completes
 * - Long audio files (>5 min) at higher risk
 * - Consider min_scale=1 for reliability
 */
import { BatchClient } from '@speechmatics/batch-client';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import pino from 'pino';
import type {
  SpeechTranscriptionPort,
  TranscriptionJobInput,
  TranscriptionJobSubmitResult,
  TranscriptionJobPollResult,
  TranscriptionTextResult,
  TranscriptionPortError,
  TranscriptionApiCall,
} from '../../domain/inbox/index.js';

const logger = pino({ name: 'speechmatics-adapter' });

/**
 * Speechmatics EU API base URL.
 */
const SPEECHMATICS_EU_API_URL = 'https://asr.api.speechmatics.com/v2';

/**
 * Create a TranscriptionApiCall record.
 */
function createApiCall(
  operation: TranscriptionApiCall['operation'],
  success: boolean,
  response?: unknown
): TranscriptionApiCall {
  return {
    timestamp: new Date().toISOString(),
    operation,
    success,
    response,
  };
}

/**
 * Speechmatics implementation of SpeechTranscriptionPort.
 */
export class SpeechmaticsTranscriptionAdapter implements SpeechTranscriptionPort {
  private readonly client: BatchClient;

  constructor(apiKey: string) {
    this.client = new BatchClient({
      apiKey,
      apiUrl: SPEECHMATICS_EU_API_URL,
      appId: 'intexuraos-whatsapp-service',
    });
  }

  /**
   * Submit an audio file for transcription.
   */
  async submitJob(
    input: TranscriptionJobInput
  ): Promise<Result<TranscriptionJobSubmitResult, TranscriptionPortError>> {
    const startTime = Date.now();

    logger.info(
      {
        event: 'speechmatics_submit_start',
        audioUrl: input.audioUrl,
        mimeType: input.mimeType,
        language: input.language,
      },
      'Submitting transcription job to Speechmatics'
    );

    try {
      const response = await this.client.createTranscriptionJob(
        { url: input.audioUrl },
        {
          transcription_config: {
            language: input.language ?? 'auto',
            operating_point: 'enhanced',
          },
        }
      );

      const durationMs = Date.now() - startTime;
      const apiCall = createApiCall('submit', true, { jobId: response.id });

      logger.info(
        {
          event: 'speechmatics_submit_success',
          jobId: response.id,
          durationMs,
        },
        'Transcription job submitted successfully'
      );

      return ok({
        jobId: response.id,
        apiCall,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      const apiCall = createApiCall('submit', false, { error: errorMessage });

      logger.error(
        {
          event: 'speechmatics_submit_error',
          error: errorMessage,
          durationMs,
          audioUrl: input.audioUrl,
        },
        'Failed to submit transcription job'
      );

      return err({
        code: 'SPEECHMATICS_SUBMIT_ERROR',
        message: errorMessage,
        apiCall,
      });
    }
  }

  /**
   * Poll the status of a transcription job.
   */
  async pollJob(
    jobId: string
  ): Promise<Result<TranscriptionJobPollResult, TranscriptionPortError>> {
    const startTime = Date.now();

    logger.info(
      {
        event: 'speechmatics_poll_start',
        jobId,
      },
      'Polling transcription job status'
    );

    try {
      const response = await this.client.getJob(jobId);
      const durationMs = Date.now() - startTime;
      const jobStatus = response.job.status;

      // Map Speechmatics status to our status
      let status: TranscriptionJobPollResult['status'];
      if (jobStatus === 'done') {
        status = 'done';
      } else if (jobStatus === 'rejected') {
        status = 'rejected';
      } else {
        status = 'running';
      }

      const apiCall = createApiCall('poll', true, {
        jobId,
        status: jobStatus,
        rawStatus: response.job.status,
      });

      logger.info(
        {
          event: 'speechmatics_poll_success',
          jobId,
          status,
          rawStatus: jobStatus,
          durationMs,
        },
        'Poll successful'
      );

      const result: TranscriptionJobPollResult = {
        status,
        apiCall,
      };

      // Add error details if rejected
      if (status === 'rejected' && response.job.errors !== undefined) {
        const errorsValue: unknown = response.job.errors;
        let errorMessage: string;
        if (Array.isArray(errorsValue)) {
          errorMessage = errorsValue
            .map((e: unknown) => (typeof e === 'string' ? e : JSON.stringify(e)))
            .join('; ');
        } else {
          errorMessage =
            typeof errorsValue === 'string' ? errorsValue : JSON.stringify(errorsValue);
        }
        result.error = {
          code: 'JOB_REJECTED',
          message: errorMessage,
        };
      }

      return ok(result);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      const apiCall = createApiCall('poll', false, { error: errorMessage });

      logger.error(
        {
          event: 'speechmatics_poll_error',
          jobId,
          error: errorMessage,
          durationMs,
        },
        'Failed to poll job status'
      );

      return err({
        code: 'SPEECHMATICS_POLL_ERROR',
        message: errorMessage,
        apiCall,
      });
    }
  }

  /**
   * Fetch the transcription result for a completed job.
   */
  async getTranscript(
    jobId: string
  ): Promise<Result<TranscriptionTextResult, TranscriptionPortError>> {
    const startTime = Date.now();

    logger.info(
      {
        event: 'speechmatics_transcript_start',
        jobId,
      },
      'Fetching transcription result'
    );

    try {
      const transcript = await this.client.getJobResult(jobId, 'text');
      const durationMs = Date.now() - startTime;

      const apiCall = createApiCall('fetch_result', true, {
        jobId,
        transcriptLength: transcript.length,
      });

      logger.info(
        {
          event: 'speechmatics_transcript_success',
          jobId,
          transcriptLength: transcript.length,
          durationMs,
        },
        'Transcription fetched successfully'
      );

      return ok({
        text: transcript,
        apiCall,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      const apiCall = createApiCall('fetch_result', false, { error: errorMessage });

      logger.error(
        {
          event: 'speechmatics_transcript_error',
          jobId,
          error: errorMessage,
          durationMs,
        },
        'Failed to fetch transcription'
      );

      return err({
        code: 'SPEECHMATICS_TRANSCRIPT_ERROR',
        message: errorMessage,
        apiCall,
      });
    }
  }
}
