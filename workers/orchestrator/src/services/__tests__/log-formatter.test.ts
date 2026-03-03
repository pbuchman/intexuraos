import { describe, expect, it } from 'vitest';
import { stripDockerHeaders, summarizeFirstLast } from '../log-formatter.js';

describe('summarizeFirstLast', () => {
  it('returns single line unchanged', () => {
    expect(summarizeFirstLast('only one line')).toBe('only one line');
  });

  it('returns two non-empty lines unchanged', () => {
    expect(summarizeFirstLast('first line\nsecond line')).toBe('first line\nsecond line');
  });

  it('truncates to first and last when >2 non-empty lines', () => {
    const text = 'first\nsecond\nthird\nfourth\nfifth';
    const result = summarizeFirstLast(text);
    expect(result).toContain('first');
    expect(result).toContain('fifth');
    expect(result).toContain('3 lines omitted');
    expect(result).not.toContain('second');
    expect(result).not.toContain('third');
    expect(result).not.toContain('fourth');
  });

  it('filters whitespace-only lines before counting', () => {
    const text = 'first\n   \n  \nthird';
    const result = summarizeFirstLast(text);
    // Only 2 non-empty lines: "first" and "third" → returned as-is
    expect(result).toBe('first\nthird');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(summarizeFirstLast('   \n  \n   ')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(summarizeFirstLast('')).toBe('');
  });

  it('handles exactly 3 non-empty lines', () => {
    const text = 'alpha\nbeta\ngamma';
    const result = summarizeFirstLast(text);
    expect(result).toContain('alpha');
    expect(result).toContain('gamma');
    expect(result).toContain('1 line omitted');
    expect(result).not.toContain('beta');
  });

  it('preserves content of first and last lines exactly', () => {
    const text = 'line one with spaces  \nline two\nline three\n  line four with indent';
    const result = summarizeFirstLast(text);
    expect(result).toContain('line one with spaces');
    expect(result).toContain('line four with indent');
  });
});

describe('stripDockerHeaders', () => {
  it('returns plain text unchanged', () => {
    expect(stripDockerHeaders('hello world')).toBe('hello world');
  });
});
