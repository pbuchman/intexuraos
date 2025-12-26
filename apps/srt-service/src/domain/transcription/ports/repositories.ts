/**
 * Repository Ports for Transcription Domain.
 */
import type { Result } from '@intexuraos/common';
import type { TranscriptionJob } from '../models/index.js';

/**
 * Error type for transcription operations.
 */
export interface TranscriptionError {
  code: 'NOT_FOUND' | 'PERSISTENCE_ERROR' | 'VALIDATION_ERROR' | 'INTERNAL_ERROR';
  message: string;
}

/**
 * Port for TranscriptionJob persistence.
 */
export interface TranscriptionJobRepository {
  /**
   * Create a new transcription job.
   */
  create(job: Omit<TranscriptionJob, 'id'>): Promise<Result<TranscriptionJob, TranscriptionError>>;

  /**
   * Get a job by ID.
   */
  getById(id: string): Promise<Result<TranscriptionJob | null, TranscriptionError>>;

  /**
   * Find existing job by messageId and mediaId (idempotency check).
   */
  findByMediaKey(
    messageId: string,
    mediaId: string
  ): Promise<Result<TranscriptionJob | null, TranscriptionError>>;

  /**
   * Update job status and related fields.
   */
  update(
    id: string,
    updates: Partial<
      Pick<
        TranscriptionJob,
        | 'status'
        | 'speechmaticsJobId'
        | 'transcript'
        | 'error'
        | 'pollAttempts'
        | 'nextPollAt'
        | 'completedAt'
        | 'updatedAt'
      >
    >
  ): Promise<Result<TranscriptionJob, TranscriptionError>>;

  /**
   * Get jobs that are ready to poll (status = processing, nextPollAt <= now).
   */
  getJobsReadyToPoll(limit?: number): Promise<Result<TranscriptionJob[], TranscriptionError>>;

  /**
   * Get pending jobs (status = pending, not yet submitted to Speechmatics).
   */
  getPendingJobs(limit?: number): Promise<Result<TranscriptionJob[], TranscriptionError>>;
}
