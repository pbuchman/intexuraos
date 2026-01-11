import { describe, it, expect } from 'vitest';
import { formatSpeechmaticsError } from '../../../domain/whatsapp/formatSpeechmaticsError.js';

describe('formatSpeechmaticsError', () => {
  describe('JSON error responses', () => {
    it('extracts message field from JSON error', () => {
      const rawError = JSON.stringify({
        message: 'Language identification could not identify any language with sufficient confidence',
        timestamp: '2026-01-10T12:13:09.568Z',
      });

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe(
        'Language identification could not identify any language with sufficient confidence'
      );
    });

    it('extracts detail field when message is missing', () => {
      const rawError = JSON.stringify({
        detail: 'Audio format not supported',
        timestamp: '2026-01-10T12:13:09.568Z',
      });

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe('Audio format not supported');
    });

    it('returns raw error when JSON has no message or detail', () => {
      const rawError = JSON.stringify({
        error: 'something',
        timestamp: '2026-01-10T12:13:09.568Z',
      });

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe(rawError);
    });

    it('returns raw error when message is empty string', () => {
      const rawError = JSON.stringify({
        message: '',
        timestamp: '2026-01-10T12:13:09.568Z',
      });

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe(rawError);
    });

    it('returns raw error when detail is empty string', () => {
      const rawError = JSON.stringify({
        detail: '',
        timestamp: '2026-01-10T12:13:09.568Z',
      });

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe(rawError);
    });
  });

  describe('plain text error patterns', () => {
    it('extracts language identification error message', () => {
      const rawError =
        'Language identification could not identify any language with sufficient confidence';

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe(
        'Language identification could not identify any language with sufficient confidence'
      );
    });

    it('formats insufficient audio error', () => {
      const rawError = 'Error: insufficient audio data for transcription';

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe('Audio file is too short for transcription');
    });

    it('formats unsupported format error', () => {
      const rawError = 'Audio codec in unsupported format';

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe('Audio format is not supported');
    });

    it('formats rate limit error', () => {
      const rawError = 'Request failed due to rate limit exceeded';

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe('Transcription service rate limit exceeded. Please try again later.');
    });

    it('formats quota exceeded error', () => {
      const rawError = 'Monthly quota exceeded for transcription service';

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe('Transcription quota exceeded');
    });

    it('formats timeout error', () => {
      const rawError = 'Request timeout after 30 seconds';

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe('Transcription service request timed out');
    });

    it('formats network error', () => {
      const rawError = 'Network connection failed';

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe('Could not connect to transcription service');
    });

    it('formats connection error', () => {
      const rawError = 'Connection refused by server';

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe('Could not connect to transcription service');
    });
  });

  describe('error truncation', () => {
    it('truncates very long error messages', () => {
      const longError =
        'This is a very long error message that exceeds 100 characters and should be truncated to prevent overwhelming the user interface with too much text';

      const result = formatSpeechmaticsError(longError);

      // Should truncate to 97 chars + "..." = 100 total
      expect(result).toBe(longError.slice(0, 97) + '...');
      expect(result.length).toBe(100);
      expect(result.endsWith('...')).toBe(true);
    });

    it('does not truncate error messages under 100 characters', () => {
      const shortError = 'This is a short error message';

      const result = formatSpeechmaticsError(shortError);

      expect(result).toBe(shortError);
    });
  });

  describe('edge cases', () => {
    it('handles invalid JSON gracefully', () => {
      const invalidJson = '{"message": invalid json}';

      const result = formatSpeechmaticsError(invalidJson);

      expect(result).toBe(invalidJson);
    });

    it('handles empty string', () => {
      const result = formatSpeechmaticsError('');

      expect(result).toBe('');
    });

    it('handles null-like JSON values', () => {
      const rawError = JSON.stringify({
        message: null,
        detail: undefined,
      });

      const result = formatSpeechmaticsError(rawError);

      expect(result).toBe(rawError);
    });
  });
});
