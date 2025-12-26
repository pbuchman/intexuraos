/**
 * Speechmatics Batch API Client.
 */
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common';
import type {
  SpeechmaticsClient,
  CreateJobResponse,
  JobStatusResponse,
  TranscriptionError,
} from '../../domain/transcription/index.js';

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
        return err({
          code: 'INTERNAL_ERROR',
          message: `Speechmatics API error: ${String(response.status)} - ${errorBody}`,
        });
      }

      const data = (await response.json()) as { id: string };

      return ok({ id: data.id });
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return err({
          code: 'INTERNAL_ERROR',
          message: `Speechmatics request timed out after ${String(REQUEST_TIMEOUT_MS)}ms`,
        });
      }

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

    try {
      const response = await fetch(`${SPEECHMATICS_API_BASE}/jobs/${jobId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
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
        return err({
          code: 'INTERNAL_ERROR',
          message: `Speechmatics request timed out after ${String(REQUEST_TIMEOUT_MS)}ms`,
        });
      }

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

    try {
      const response = await fetch(`${SPEECHMATICS_API_BASE}/jobs/${jobId}/transcript?format=txt`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        return err({
          code: 'INTERNAL_ERROR',
          message: `Speechmatics transcript error: ${String(response.status)} - ${errorBody}`,
        });
      }

      const transcript = await response.text();
      return ok(transcript);
    } catch (error) {
      clearTimeout(timeoutId);

      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get transcript: ${getErrorMessage(error)}`,
      });
    }
  }
}
