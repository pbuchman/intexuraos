/**
 * Event Publisher Port for Transcription Domain.
 */
import type { Result } from '@intexuraos/common';
import type { TranscriptionError } from './repositories.js';

/**
 * Event published when transcription is completed.
 */
export interface TranscriptionCompletedEvent {
  /**
   * Event type identifier.
   */
  type: 'srt.transcription.completed';

  /**
   * IntexuraOS user ID.
   */
  userId: string;

  /**
   * WhatsApp message ID.
   */
  messageId: string;

  /**
   * WhatsApp media ID.
   */
  mediaId: string;

  /**
   * Transcription job ID (srt-service internal ID).
   */
  jobId: string;

  /**
   * Status of transcription.
   */
  status: 'completed' | 'failed';

  /**
   * Transcription text (when completed successfully).
   */
  transcript?: string;

  /**
   * Error message (when failed).
   */
  error?: string;

  /**
   * Event timestamp (ISO 8601).
   */
  timestamp: string;
}

/**
 * Port for publishing transcription events.
 */
export interface TranscriptionEventPublisher {
  /**
   * Publish transcription completed event.
   */
  publishCompleted(event: TranscriptionCompletedEvent): Promise<Result<void, TranscriptionError>>;
}
