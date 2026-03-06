/**
 * Transcription provider factory.
 *
 * Creates the appropriate transcription provider adapter based on the provider name.
 * Defaults to Speechmatics if the requested provider is unknown.
 */
import type { SpeechTranscriptionPort } from './transcription-provider.js';
import { SpeechmaticsTranscriptionAdapter } from './speechmatics/adapter.js';

/**
 * Create a transcription provider by name.
 *
 * @param providerName - Provider name from user settings (e.g., 'speechmatics')
 * @param speechmaticsApiKey - API key for Speechmatics
 * @returns A SpeechTranscriptionPort implementation
 */
export function createTranscriptionProvider(
  providerName: string,
  speechmaticsApiKey: string
): SpeechTranscriptionPort {
  switch (providerName) {
    case 'speechmatics':
      return new SpeechmaticsTranscriptionAdapter(speechmaticsApiKey);
    default:
      // Default to Speechmatics for unknown providers
      return new SpeechmaticsTranscriptionAdapter(speechmaticsApiKey);
  }
}
