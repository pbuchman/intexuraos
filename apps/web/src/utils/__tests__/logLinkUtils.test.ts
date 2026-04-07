import { describe, expect, it } from 'vitest';
import { parseLogLine, formatUrlForDisplay } from '../logLinkUtils.js';
import type { URLSegment } from '../logLinkUtils.js';

describe('parseLogLine', () => {
  it('returns plain text when no URL is present', () => {
    const result = parseLogLine('[claude] Hello world');
    expect(result).toEqual(['[claude] Hello world']);
  });

  it('extracts a single HTTP URL', () => {
    const result = parseLogLine('Visit http://example.com for more');
    expect(result).toEqual([
      'Visit ',
      { type: 'url', url: 'http://example.com' },
      ' for more',
    ]);
  });

  it('extracts a single HTTPS URL', () => {
    const result = parseLogLine('See https://github.com/org/repo/pull/123');
    expect(result).toEqual([
      'See ',
      { type: 'url', url: 'https://github.com/org/repo/pull/123' },
    ]);
  });

  it('extracts multiple URLs from one line', () => {
    const result = parseLogLine('Links: https://a.com and https://b.com done');
    expect(result).toEqual([
      'Links: ',
      { type: 'url', url: 'https://a.com' },
      ' and ',
      { type: 'url', url: 'https://b.com' },
      ' done',
    ]);
  });

  it('handles URL at the start of the line', () => {
    const result = parseLogLine('https://start.com is the link');
    expect(result).toEqual([
      { type: 'url', url: 'https://start.com' },
      ' is the link',
    ]);
  });

  it('handles URL at the end of the line', () => {
    const result = parseLogLine('Go to https://end.com');
    expect(result).toEqual([
      'Go to ',
      { type: 'url', url: 'https://end.com' },
    ]);
  });

  it('handles URL with query parameters and fragments', () => {
    const result = parseLogLine('URL: https://example.com/path?q=1&r=2#section');
    expect(result).toEqual([
      'URL: ',
      { type: 'url', url: 'https://example.com/path?q=1&r=2#section' },
    ]);
  });

  it('returns single-element array for empty string', () => {
    const result = parseLogLine('');
    expect(result).toEqual(['']);
  });

  it('does not match non-http protocols', () => {
    const result = parseLogLine('Use ftp://files.example.com');
    expect(result).toEqual(['Use ftp://files.example.com']);
  });

  it('handles URL followed by punctuation that is not part of URL', () => {
    const result = parseLogLine('See https://example.com.');
    expect(result).toHaveLength(2);
    const urlSegment = result[1] as URLSegment;
    expect(urlSegment.type).toBe('url');
    expect(urlSegment.url).toBe('https://example.com');
  });

  it('handles URL with port number', () => {
    const result = parseLogLine('Server at http://localhost:3000/health');
    expect(result).toEqual([
      'Server at ',
      { type: 'url', url: 'http://localhost:3000/health' },
    ]);
  });

  it('handles URL inside prose parentheses', () => {
    const result = parseLogLine('(see https://example.com)');
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('(see ');
    const urlSegment = result[1] as URLSegment;
    expect(urlSegment.type).toBe('url');
    expect(urlSegment.url).toBe('https://example.com');
    expect(result[2]).toBe(')');
  });
});

describe('formatUrlForDisplay', () => {
  it('returns short URLs unchanged', () => {
    expect(formatUrlForDisplay('https://example.com')).toBe('https://example.com');
  });

  it('returns URLs at exactly 80 chars unchanged', () => {
    const url = 'https://example.com/' + 'a'.repeat(60);
    expect(url).toHaveLength(80);
    expect(formatUrlForDisplay(url)).toBe(url);
  });

  it('truncates URLs longer than 80 chars', () => {
    const url = 'https://example.com/' + 'a'.repeat(100);
    expect(url.length).toBeGreaterThan(80);
    const result = formatUrlForDisplay(url);
    expect(result).toContain('…');
    expect(result.length).toBeLessThan(url.length);
  });

  it('shows first 40 + ellipsis + last 30 chars for long URLs', () => {
    const url = 'https://example.com/' + 'x'.repeat(100);
    const result = formatUrlForDisplay(url);
    expect(result.slice(0, 40)).toBe(url.slice(0, 40));
    expect(result.slice(-30)).toBe(url.slice(-30));
    expect(result).toContain('…');
  });
});
