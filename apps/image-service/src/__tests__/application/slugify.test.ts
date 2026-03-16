import { describe, it, expect } from 'vitest';

import { slugify } from '../../application/slugify.js';

describe('slugify', () => {
  it('basic slugification', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips unicode diacritics', () => {
    expect(slugify('Cafe\u0301 Re\u0301sume\u0301 Noe\u0308l')).toBe('cafe-resume-noel');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('truncates at maxLength (50 default)', () => {
    const longTitle = 'This is a very long title that exceeds the default maximum length of fifty characters';
    const result = slugify(longTitle);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('custom maxLength', () => {
    expect(slugify('abcdef', 3)).toBe('abc');
  });

  it('collapses multiple dashes', () => {
    expect(slugify('a---b')).toBe('a-b');
  });

  it('strips trailing dash after truncation', () => {
    const title = 'a'.repeat(49) + ' bbbbb';
    const result = slugify(title);
    expect(result).toBe('a'.repeat(49));
  });

  it('removes special characters', () => {
    expect(slugify('hello@world#test')).toBe('helloworldtest');
  });
});
