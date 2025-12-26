/**
 * SRT Service HTTP Client implementation.
 * Calls srt-service API to create and submit transcription jobs.
 */
import { ok, err, type Result } from '@intexuraos/common';

/**
 * Transcription job from SRT service.
 */
export interface TranscriptionJob {
  id: string;
  messageId: string;
  mediaId: string;
  userId: string;
  gcsPath: string;
  mimeType: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  speechmaticsJobId?: string;
  transcript?: string;
  error?: string;
  pollAttempts: number;
  nextPollAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Request to create a transcription job.
 */
export interface CreateJobRequest {
  messageId: string;
  mediaId: string;
  userId: string;
  gcsPath: string;
  mimeType: string;
}

/**
 * Error from SRT client operations.
 */
export interface SrtClientError {
  code: string;
  message: string;
}

/**
 * Port interface for SRT service client.
 */
export interface SrtServiceClientPort {
  /**
   * Create a transcription job.
   */
  createJob(request: CreateJobRequest): Promise<Result<TranscriptionJob, SrtClientError>>;

  /**
   * Submit a pending job to Speechmatics.
   */
  submitJob(jobId: string): Promise<Result<TranscriptionJob, SrtClientError>>;

  /**
   * Get job status/details.
   */
  getJob(jobId: string): Promise<Result<TranscriptionJob | null, SrtClientError>>;
}

/**
 * HTTP client for SRT service.
 */
export class SrtServiceClient implements SrtServiceClientPort {
  private readonly baseUrl: string;

  constructor(srtServiceUrl: string) {
    // Remove trailing slash if present
    this.baseUrl = srtServiceUrl.replace(/\/$/, '');
  }

  async createJob(request: CreateJobRequest): Promise<Result<TranscriptionJob, SrtClientError>> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = (await response.json()) as {
        success: boolean;
        data?: TranscriptionJob;
        error?: { code: string; message: string };
      };

      if (!response.ok || !data.success) {
        return err({
          code: data.error?.code ?? 'SRT_ERROR',
          message: data.error?.message ?? `HTTP ${String(response.status)}`,
        });
      }

      if (data.data === undefined) {
        return err({
          code: 'INVALID_RESPONSE',
          message: 'Missing data in response',
        });
      }

      return ok(data.data);
    } catch (error) {
      return err({
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown network error',
      });
    }
  }

  async submitJob(jobId: string): Promise<Result<TranscriptionJob, SrtClientError>> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/transcribe/${jobId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = (await response.json()) as {
        success: boolean;
        data?: TranscriptionJob;
        error?: { code: string; message: string };
      };

      if (!response.ok || !data.success) {
        return err({
          code: data.error?.code ?? 'SRT_ERROR',
          message: data.error?.message ?? `HTTP ${String(response.status)}`,
        });
      }

      if (data.data === undefined) {
        return err({
          code: 'INVALID_RESPONSE',
          message: 'Missing data in response',
        });
      }

      return ok(data.data);
    } catch (error) {
      return err({
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown network error',
      });
    }
  }

  async getJob(jobId: string): Promise<Result<TranscriptionJob | null, SrtClientError>> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/transcribe/${jobId}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        return ok(null);
      }

      const data = (await response.json()) as {
        success: boolean;
        data?: TranscriptionJob;
        error?: { code: string; message: string };
      };

      if (!response.ok || !data.success) {
        return err({
          code: data.error?.code ?? 'SRT_ERROR',
          message: data.error?.message ?? `HTTP ${String(response.status)}`,
        });
      }

      if (data.data === undefined) {
        return err({
          code: 'INVALID_RESPONSE',
          message: 'Missing data in response',
        });
      }

      return ok(data.data);
    } catch (error) {
      return err({
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown network error',
      });
    }
  }
}
