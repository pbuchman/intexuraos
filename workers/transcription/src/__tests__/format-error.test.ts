import { describe, it, expect } from 'vitest';
import { formatSpeechmaticsError } from '../format-error.js';

describe('formatSpeechmaticsError', () => {
  it('extracts message field from JSON error', () => {
    const result = formatSpeechmaticsError(
      JSON.stringify({ message: 'API key invalid', timestamp: '2024-01-01' })
    );
    expect(result).toBe('API key invalid');
  });

  it('extracts detail field when message is absent', () => {
    const result = formatSpeechmaticsError(JSON.stringify({ detail: 'Quota exceeded' }));
    expect(result).toBe('Quota exceeded');
  });

  it('returns raw error when JSON has no message or detail', () => {
    const result = formatSpeechmaticsError(JSON.stringify({ code: 'UNKNOWN' }));
    expect(result).toBe(JSON.stringify({ code: 'UNKNOWN' }));
  });

  it('handles non-JSON string with Language identification', () => {
    const result = formatSpeechmaticsError(
      'Language identification failed due to insufficient audio'
    );
    expect(result).toBe('Language identification failed due to insufficient audio');
  });

  it('returns raw string when Language identification regex does not match', () => {
    // 'Language identification.' has no non-period chars after, so regex returns null
    const result = formatSpeechmaticsError('Language identification.');
    expect(result).toBe('Language identification.');
  });

  it('handles insufficient audio error', () => {
    const result = formatSpeechmaticsError('Error: insufficient audio provided');
    expect(result).toBe('Audio file is too short for transcription');
  });

  it('handles unsupported format error', () => {
    const result = formatSpeechmaticsError('The audio has unsupported format');
    expect(result).toBe('Audio format is not supported');
  });

  it('handles rate limit error', () => {
    const result = formatSpeechmaticsError('You have exceeded the rate limit');
    expect(result).toBe('Transcription service rate limit exceeded. Please try again later.');
  });

  it('handles quota exceeded error', () => {
    const result = formatSpeechmaticsError('Your quota exceeded for this month');
    expect(result).toBe('Transcription quota exceeded');
  });

  it('handles timeout error (lowercase)', () => {
    const result = formatSpeechmaticsError('request timeout occurred');
    expect(result).toBe('Transcription service request timed out');
  });

  it('handles Timeout error (capitalized)', () => {
    const result = formatSpeechmaticsError('Timeout: The request took too long');
    expect(result).toBe('Transcription service request timed out');
  });

  it('handles network error', () => {
    const result = formatSpeechmaticsError('network connection failed');
    expect(result).toBe('Could not connect to transcription service');
  });

  it('handles connection error', () => {
    const result = formatSpeechmaticsError('Connection refused by server');
    expect(result).toBe('Could not connect to transcription service');
  });

  it('truncates long error messages', () => {
    const longError = 'a'.repeat(200);
    const result = formatSpeechmaticsError(longError);
    expect(result).toHaveLength(100);
    expect(result.endsWith('...')).toBe(true);
  });

  it('returns short error messages as-is', () => {
    const result = formatSpeechmaticsError('Short error');
    expect(result).toBe('Short error');
  });

  it('returns raw string when JSON parse fails and no pattern matches', () => {
    const result = formatSpeechmaticsError('not json, just a plain message');
    expect(result).toBe('not json, just a plain message');
  });

  it('skips message field when it is empty string', () => {
    const result = formatSpeechmaticsError(JSON.stringify({ message: '', detail: 'Some detail' }));
    expect(result).toBe('Some detail');
  });

  it('skips detail field when it is empty string', () => {
    const result = formatSpeechmaticsError(JSON.stringify({ message: '', detail: '' }));
    // Neither message nor detail - falls through to JSON.stringify
    expect(result).toBe(JSON.stringify({ message: '', detail: '' }));
  });
});
