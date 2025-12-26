/**
 * Speechmatics Client Port.
 * Defines interface for Speechmatics Batch API operations.
 */
import type { Result } from '@intexuraos/common';
import type { TranscriptionError } from './repositories.js';

/**
 * Status of a Speechmatics job.
 */
export type SpeechmaticsJobStatus = 'accepted' | 'running' | 'done' | 'rejected' | 'deleted';

/**
 * Response from Speechmatics job creation.
 */
export interface CreateJobResponse {
  /**
   * Speechmatics job ID.
   */
  id: string;
}

/**
 * Response from Speechmatics job status check.
 */
export interface JobStatusResponse {
  /**
   * Speechmatics job ID.
   */
  id: string;

  /**
   * Current job status.
   */
  status: SpeechmaticsJobStatus;

  /**
   * Transcript text (available when status is 'done').
   */
  transcript?: string;

  /**
   * Error message (available when status is 'rejected').
   */
  error?: string;
}

/**
 * Port for Speechmatics Batch API operations.
 */
export interface SpeechmaticsClient {
  /**
   * Create a new transcription job.
   *
   * @param audioUrl - GCS signed URL to the audio file
   * @param languageCode - Language code (default: 'pl')
   * @returns Speechmatics job ID
   */
  createJob(
    audioUrl: string,
    languageCode?: string
  ): Promise<Result<CreateJobResponse, TranscriptionError>>;

  /**
   * Get job status and transcript if available.
   *
   * @param jobId - Speechmatics job ID
   */
  getJobStatus(jobId: string): Promise<Result<JobStatusResponse, TranscriptionError>>;
}
