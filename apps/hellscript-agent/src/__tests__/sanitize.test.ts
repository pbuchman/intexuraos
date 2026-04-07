import { describe, it, expect } from 'vitest';
import { escapeXmlTags } from '../domain/services/sanitize.js';
import { isValidCategory } from '../domain/models/writingCategory.js';

describe('escapeXmlTags', () => {
  it('escapes angle brackets', () => {
    expect(escapeXmlTags('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;'
    );
  });

  it('returns string unchanged when no tags present', () => {
    expect(escapeXmlTags('Just normal text')).toBe('Just normal text');
  });

  it('handles empty string', () => {
    expect(escapeXmlTags('')).toBe('');
  });

  it('escapes multiple tags', () => {
    expect(escapeXmlTags('<a><b>')).toBe('&lt;a&gt;&lt;b&gt;');
  });
});

describe('isValidCategory', () => {
  it('returns true for threads', () => {
    expect(isValidCategory('threads')).toBe(true);
  });

  it('returns true for linkedin', () => {
    expect(isValidCategory('linkedin')).toBe(true);
  });

  it('returns true for general', () => {
    expect(isValidCategory('general')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isValidCategory('twitter')).toBe(false);
    expect(isValidCategory('')).toBe(false);
    expect(isValidCategory('THREADS')).toBe(false);
  });
});
