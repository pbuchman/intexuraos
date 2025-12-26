/**
 * Port interface for speech-to-text transcription services.
 *
 * This port abstracts the transcription provider, allowing the domain
 * to remain agnostic of the specific implementation (Speechmatics, Whisper, etc.).
 *
 * ## Provider Swapping
 *
 * To switch transcription providers:
 * 1. Create a new adapter in `src/infra/<provider>/` implementing this port
 * 2. Update `services.ts` to inject the new adapter
 * 3. No changes needed in domain or route code
 */
import type { Result } from '@intexuraos/common';
import type { TranscriptionApiCall, TranscriptionError } from '../models/WhatsAppMessage.js';

/**
 * Input for submitting a transcription job.
 */
export interface TranscriptionJobInput {
  /**
   * URL to the audio file (e.g., GCS signed URL).
   */
  audioUrl: string;

  /**
   * MIME type of the audio file.
   */
  mimeType: string;

  /**
   * Language code for transcription (e.g., 'en', 'pl').
   * If not specified, provider may auto-detect.
   */
  language?: string;
}

/**
 * Result of submitting a transcription job.
 */
export interface TranscriptionJobSubmitResult {
  /**
   * Provider-specific job ID.
   */
  jobId: string;

  /**
   * API call details for tracking.
   */
  apiCall: TranscriptionApiCall;
}

/**
 * Status of a transcription job from the provider.
 */
export type TranscriptionJobStatus = 'running' | 'done' | 'rejected';

/**
 * Result of polling a transcription job status.
 */
export interface TranscriptionJobPollResult {
  /**
   * Current job status.
   */
  status: TranscriptionJobStatus;

  /**
   * Error details if job was rejected.
   */
  error?: TranscriptionError;

  /**
   * API call details for tracking.
   */
  apiCall: TranscriptionApiCall;
}

/**
 * Result of fetching the transcription text.
 */
export interface TranscriptionTextResult {
  /**
   * The transcribed text.
   */
  text: string;

  /**
   * API call details for tracking.
   */
  apiCall: TranscriptionApiCall;
}

/**
 * Error from transcription operations.
 */
export interface TranscriptionPortError {
  code: string;
  message: string;
  apiCall?: TranscriptionApiCall;
}

/**
 * Port interface for speech-to-text transcription.
 *
 * Implementations should:
 * - Log all API calls with request/response details
 * - Handle retries internally for transient errors
 * - Return detailed error information for debugging
 */
export interface SpeechTranscriptionPort {
  /**
   * Submit an audio file for transcription.
   *
   * @param input - Audio file details and configuration
   * @returns Job ID and API call tracking on success
   */
  submitJob(
    input: TranscriptionJobInput
  ): Promise<Result<TranscriptionJobSubmitResult, TranscriptionPortError>>;

  /**
   * Poll the status of a transcription job.
   *
   * @param jobId - Provider-specific job ID
   * @returns Current status and API call tracking
   */
  pollJob(jobId: string): Promise<Result<TranscriptionJobPollResult, TranscriptionPortError>>;

  /**
   * Fetch the transcription result for a completed job.
   *
   * @param jobId - Provider-specific job ID
   * @returns Transcribed text and API call tracking
   */
  getTranscript(jobId: string): Promise<Result<TranscriptionTextResult, TranscriptionPortError>>;
}
