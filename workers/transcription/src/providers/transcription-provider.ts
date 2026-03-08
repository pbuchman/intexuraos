/**
 * Port interface for speech-to-text transcription providers.
 *
 * Defines the contract that all transcription provider adapters must implement.
 * This enables provider swapping without changing business logic.
 */
import type { Result } from '@intexuraos/common-core';

/**
 * API call tracking for debugging transcription operations.
 */
export interface TranscriptionApiCall {
  timestamp: string;
  operation: 'submit' | 'poll' | 'fetch_result';
  success: boolean;
  response?: unknown;
}

/**
 * Input for submitting a transcription job.
 */
export interface TranscriptionJobInput {
  /** URL to the audio file (e.g., GCS signed URL). */
  audioUrl: string;
  /** MIME type of the audio file. */
  mimeType: string;
  /** Language code for transcription. If not specified, auto-detected. */
  language?: string;
}

/**
 * Result of submitting a transcription job.
 */
export interface TranscriptionJobSubmitResult {
  /** Provider-specific job ID. */
  jobId: string;
  /** API call details for tracking. */
  apiCall: TranscriptionApiCall;
}

/**
 * Status of a transcription job from the provider.
 */
export type TranscriptionJobStatus = 'running' | 'done' | 'rejected';

/**
 * Error from transcription provider operations.
 */
export interface TranscriptionPortError {
  code: string;
  message: string;
  apiCall?: TranscriptionApiCall;
}

/**
 * Result of polling a transcription job status.
 */
export interface TranscriptionJobPollResult {
  /** Current job status. */
  status: TranscriptionJobStatus;
  /** Error details if job was rejected. */
  error?: { code: string; message: string };
  /** API call details for tracking. */
  apiCall: TranscriptionApiCall;
}

/**
 * Result of fetching the transcription text.
 */
export interface TranscriptionTextResult {
  /** The transcribed text. */
  text: string;
  /** Optional AI-generated summary. */
  summary?: string;
  /** Detected language code (e.g., 'pl', 'en'). */
  detectedLanguage?: string;
  /** API call details for tracking. */
  apiCall: TranscriptionApiCall;
}

/**
 * Port interface for speech-to-text transcription.
 */
export interface SpeechTranscriptionPort {
  submitJob(
    input: TranscriptionJobInput
  ): Promise<Result<TranscriptionJobSubmitResult, TranscriptionPortError>>;

  pollJob(jobId: string): Promise<Result<TranscriptionJobPollResult, TranscriptionPortError>>;

  getTranscript(jobId: string): Promise<Result<TranscriptionTextResult, TranscriptionPortError>>;
}
