/**
 * Audio Storage Port for Transcription Domain.
 * Provides access to audio files stored in GCS.
 */
import type { Result } from '@intexuraos/common';
import type { TranscriptionError } from './repositories.js';

/**
 * Port for accessing audio files in cloud storage.
 */
export interface AudioStoragePort {
  /**
   * Generate a signed URL for accessing an audio file.
   * @param gcsPath The GCS path to the audio file (e.g., "whatsapp/user-id/message-id/file.ogg")
   * @param ttlSeconds How long the URL should be valid (default: 1 hour)
   * @returns A signed URL that Speechmatics can use to fetch the audio
   */
  getSignedUrl(gcsPath: string, ttlSeconds?: number): Promise<Result<string, TranscriptionError>>;
}
