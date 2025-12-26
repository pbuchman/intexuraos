/**
 * Speechmatics Batch API Client.
 */
import pino from 'pino';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common';
import type {
  SpeechmaticsClient,
  CreateJobResponse,
  JobStatusResponse,
  TranscriptionError,
} from '../../domain/transcription/index.js';

const logger = pino({ name: 'speechmatics-client' });

const SPEECHMATICS_API_BASE = 'https://eu1.asr.api.speechmatics.com/v2';
const DEFAULT_LANGUAGE = 'pl';
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Speechmatics Batch API implementation.
 */
export class SpeechmaticsBatchClient implements SpeechmaticsClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createJob(
    audioUrl: string,
    languageCode: string = DEFAULT_LANGUAGE
  ): Promise<Result<CreateJobResponse, TranscriptionError>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      // Speechmatics expects multipart/form-data with JSON config
      const config = {
        type: 'transcription',
        transcription_config: {
          language: languageCode,
          operating_point: 'standard',
        },
        fetch_data: {
          url: audioUrl,
        },
      };

      logger.info(
        {
          url: `${SPEECHMATICS_API_BASE}/jobs`,
          method: 'POST',
          requestBody: config,
          audioUrl,
          languageCode,
        },
        'Creating Speechmatics transcription job'
      );

      const formData = new FormData();
      formData.append('config', JSON.stringify(config));

      const response = await fetch(`${SPEECHMATICS_API_BASE}/jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(
          {
            url: `${SPEECHMATICS_API_BASE}/jobs`,
            status: response.status,
            responseBody: errorBody,
            audioUrl,
          },
          'Speechmatics job creation failed'
        );
        return err({
          code: 'INTERNAL_ERROR',
          message: `Speechmatics API error: ${String(response.status)} - ${errorBody}`,
        });
      }

      const data = (await response.json()) as { id: string };

      logger.info(
        {
          url: `${SPEECHMATICS_API_BASE}/jobs`,
          status: response.status,
          responseBody: data,
          jobId: data.id,
        },
        'Speechmatics job created successfully'
      );

      return ok({ id: data.id });
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.error(
          {
            url: `${SPEECHMATICS_API_BASE}/jobs`,
            timeoutMs: REQUEST_TIMEOUT_MS,
            audioUrl,
          },
          'Speechmatics request timed out'
        );
        return err({
          code: 'INTERNAL_ERROR',
          message: `Speechmatics request timed out after ${String(REQUEST_TIMEOUT_MS)}ms`,
        });
      }

      logger.error(
        {
          url: `${SPEECHMATICS_API_BASE}/jobs`,
          error: getErrorMessage(error),
          audioUrl,
        },
        'Failed to create Speechmatics job'
      );
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to create Speechmatics job: ${getErrorMessage(error)}`,
      });
    }
  }

  async getJobStatus(jobId: string): Promise<Result<JobStatusResponse, TranscriptionError>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    const url = `${SPEECHMATICS_API_BASE}/jobs/${jobId}`;

    try {
      logger.info(
        {
          url,
          method: 'GET',
          jobId,
        },
        'Getting Speechmatics job status'
      );

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(
          {
            url,
            status: response.status,
            responseBody: errorBody,
            jobId,
          },
          'Failed to get Speechmatics job status'
        );
        return err({
          code: 'INTERNAL_ERROR',
          message: `Speechmatics API error: ${String(response.status)} - ${errorBody}`,
        });
      }

      const data = (await response.json()) as {
        job: {
          id: string;
          status: 'accepted' | 'running' | 'done' | 'rejected' | 'deleted';
          errors?: { message: string }[];
        };
      };

      logger.info(
        {
          url,
          status: response.status,
          responseBody: data,
          jobId,
          jobStatus: data.job.status,
        },
        'Got Speechmatics job status'
      );

      const result: JobStatusResponse = {
        id: data.job.id,
        status: data.job.status,
      };

      // If job failed, extract error message
      if (data.job.status === 'rejected' && data.job.errors !== undefined) {
        result.error = data.job.errors.map((e) => e.message).join('; ');
      }

      // If job is done, fetch transcript
      if (data.job.status === 'done') {
        const transcriptResult = await this.getTranscript(jobId);
        if (transcriptResult.ok) {
          result.transcript = transcriptResult.value;
        }
      }

      return ok(result);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.error(
          {
            url,
            timeoutMs: REQUEST_TIMEOUT_MS,
            jobId,
          },
          'Speechmatics status request timed out'
        );
        return err({
          code: 'INTERNAL_ERROR',
          message: `Speechmatics request timed out after ${String(REQUEST_TIMEOUT_MS)}ms`,
        });
      }

      logger.error(
        {
          url,
          error: getErrorMessage(error),
          jobId,
        },
        'Failed to get Speechmatics job status'
      );
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get Speechmatics job status: ${getErrorMessage(error)}`,
      });
    }
  }

  /**
   * Fetch transcript text for a completed job.
   */
  private async getTranscript(jobId: string): Promise<Result<string, TranscriptionError>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    const url = `${SPEECHMATICS_API_BASE}/jobs/${jobId}/transcript?format=txt`;

    try {
      logger.info(
        {
          url,
          method: 'GET',
          jobId,
        },
        'Getting Speechmatics transcript'
      );

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(
          {
            url,
            status: response.status,
            responseBody: errorBody,
            jobId,
          },
          'Failed to get Speechmatics transcript'
        );
        return err({
          code: 'INTERNAL_ERROR',
          message: `Speechmatics transcript error: ${String(response.status)} - ${errorBody}`,
        });
      }

      const transcript = await response.text();

      logger.info(
        {
          url,
          status: response.status,
          jobId,
          transcriptLength: transcript.length,
        },
        'Got Speechmatics transcript'
      );

      return ok(transcript);
    } catch (error) {
      clearTimeout(timeoutId);

      logger.error(
        {
          url,
          error: getErrorMessage(error),
          jobId,
        },
        'Failed to get Speechmatics transcript'
      );
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get transcript: ${getErrorMessage(error)}`,
      });
    }
  }
}
