/**
 * Transcription provider factory.
 *
 * Creates the appropriate transcription provider adapter based on the provider name.
 * Defaults to Speechmatics if the requested provider is unknown.
 */
import type { SpeechTranscriptionPort } from './transcription-provider.js';
import { SpeechmaticsTranscriptionAdapter } from './speechmatics/adapter.js';
import type { Logger } from '../logger.js';

/**
 * Create a transcription provider by name.
 *
 * @param providerName - Provider name from user settings (e.g., 'speechmatics')
 * @param speechmaticsApiKey - API key for Speechmatics
 * @param logger - Logger instance for warnings
 * @returns A SpeechTranscriptionPort implementation
 */
export function createTranscriptionProvider(
  providerName: string,
  speechmaticsApiKey: string,
  logger: Logger
): SpeechTranscriptionPort {
  switch (providerName) {
    case 'speechmatics':
      return new SpeechmaticsTranscriptionAdapter(speechmaticsApiKey, logger);
    default:
      logger.warn(
        { event: 'unknown_provider', providerName },
        'Unknown transcription provider, defaulting to Speechmatics'
      );
      return new SpeechmaticsTranscriptionAdapter(speechmaticsApiKey, logger);
  }
}
