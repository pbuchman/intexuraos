/**
 * Transcription Job Model.
 * Domain model for speech-to-text transcription jobs.
 */

/**
 * Status of a transcription job.
 */
export type TranscriptionJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Transcription job domain model.
 */
export interface TranscriptionJob {
  /**
   * Internal job ID (UUID).
   */
  id: string;

  /**
   * WhatsApp message ID (for correlation).
   */
  messageId: string;

  /**
   * WhatsApp media ID (for idempotency with messageId).
   */
  mediaId: string;

  /**
   * IntexuraOS user ID.
   */
  userId: string;

  /**
   * GCS path to the audio file.
   */
  gcsPath: string;

  /**
   * MIME type of the audio file.
   */
  mimeType: string;

  /**
   * Current job status.
   */
  status: TranscriptionJobStatus;

  /**
   * Speechmatics external job ID (set after job creation).
   */
  speechmaticsJobId?: string;

  /**
   * Transcription result (set on completion).
   */
  transcript?: string;

  /**
   * Error message (set on failure).
   */
  error?: string;

  /**
   * Number of poll attempts made.
   */
  pollAttempts: number;

  /**
   * Next scheduled poll time (ISO 8601).
   */
  nextPollAt?: string;

  /**
   * Job creation timestamp (ISO 8601).
   */
  createdAt: string;

  /**
   * Last update timestamp (ISO 8601).
   */
  updatedAt: string;

  /**
   * Completion timestamp (ISO 8601).
   */
  completedAt?: string;
}
