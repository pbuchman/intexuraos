/**
 * Format Speechmatics API error messages for storage.
 * Extracts user-friendly message from Speechmatics error responses.
 */

interface SpeechmaticsErrorResponse {
  message?: string;
  timestamp?: string;
  detail?: string;
  [key: string]: unknown;
}

/**
 * Extract user-friendly error message from raw Speechmatics error.
 */
export function formatSpeechmaticsError(rawError: string): string {
  // Try parsing as JSON
  try {
    const parsed = JSON.parse(rawError) as SpeechmaticsErrorResponse;

    // Extract message field
    if (parsed.message !== undefined && parsed.message.length > 0) {
      return parsed.message;
    }

    // Fallback to detail field
    if (parsed.detail !== undefined && parsed.detail.length > 0) {
      return parsed.detail;
    }
  } catch {
    // Not JSON, continue to string parsing
  }

  // Handle common error patterns in plain text
  if (rawError.includes('Language identification')) {
    const match = /Language identification[^.]+/.exec(rawError);
    if (match !== null) {
      return match[0];
    }
  }

  if (rawError.includes('insufficient audio')) {
    return 'Audio file is too short for transcription';
  }

  if (rawError.includes('unsupported format')) {
    return 'Audio format is not supported';
  }

  if (rawError.includes('rate limit')) {
    return 'Transcription service rate limit exceeded. Please try again later.';
  }

  if (rawError.includes('quota exceeded')) {
    return 'Transcription quota exceeded';
  }

  if (rawError.toLowerCase().includes('timeout')) {
    return 'Transcription service request timed out';
  }

  if (rawError.toLowerCase().includes('network') || rawError.toLowerCase().includes('connection')) {
    return 'Could not connect to transcription service';
  }

  // Truncate very long error messages
  if (rawError.length > 100) {
    return rawError.slice(0, 97) + '...';
  }

  return rawError;
}
