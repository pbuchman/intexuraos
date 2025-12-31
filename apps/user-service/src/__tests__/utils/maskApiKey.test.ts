/**
 * Tests for maskApiKey utility.
 */
import { describe, it, expect } from 'vitest';
import { maskApiKey } from '../../domain/settings/utils/maskApiKey.js';

describe('maskApiKey', () => {
  it('masks long API keys showing first and last 4 characters', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1...cdef');
  });

  it('masks keys exactly 9 characters (minimum for partial display)', () => {
    expect(maskApiKey('123456789')).toBe('1234...6789');
  });

  it('returns asterisks for keys 8 characters or less', () => {
    expect(maskApiKey('12345678')).toBe('****');
    expect(maskApiKey('short')).toBe('****');
    expect(maskApiKey('a')).toBe('****');
    expect(maskApiKey('')).toBe('****');
  });
});
