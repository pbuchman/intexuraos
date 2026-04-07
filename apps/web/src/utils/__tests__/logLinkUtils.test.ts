import { describe, expect, it } from 'vitest';
import { formatUrlForDisplay, parseLogLine } from '../logLinkUtils.js';

describe('parseLogLine', () => {
  it('line with single URL returns one URLSegment', () => {
    const result = parseLogLine('Check https://example.com for details');
    expect(result).toStrictEqual([
      'Check ',
      { type: 'url', url: 'https://example.com' },
      ' for details',
    ]);
  });

  it('line with multiple URLs returns all URLSegments', () => {
    const result = parseLogLine('See https://foo.com and https://bar.com');
    expect(result).toStrictEqual([
      'See ',
      { type: 'url', url: 'https://foo.com' },
      ' and ',
      { type: 'url', url: 'https://bar.com' },
    ]);
  });

  it('line with no URL returns single plain text segment', () => {
    const result = parseLogLine('No links here at all');
    expect(result).toStrictEqual(['No links here at all']);
  });

  it('strips trailing period from URL', () => {
    const result = parseLogLine('See https://example.com.');
    expect(result).toStrictEqual([
      'See ',
      { type: 'url', url: 'https://example.com' },
      '.',
    ]);
  });

  it('strips trailing comma from URL', () => {
    const result = parseLogLine('Visit https://example.com, then continue');
    expect(result).toStrictEqual([
      'Visit ',
      { type: 'url', url: 'https://example.com' },
      ', then continue',
    ]);
  });

  it('strips trailing closing parenthesis from URL', () => {
    const result = parseLogLine('(see https://example.com)');
    expect(result).toStrictEqual([
      '(see ',
      { type: 'url', url: 'https://example.com' },
      ')',
    ]);
  });

  it('strips trailing semicolon from URL', () => {
    const result = parseLogLine('URL: https://example.com; next');
    expect(result).toStrictEqual([
      'URL: ',
      { type: 'url', url: 'https://example.com' },
      '; next',
    ]);
  });

  it("strips trailing single quote from URL", () => {
    const result = parseLogLine("it's at https://example.com'");
    expect(result).toStrictEqual([
      "it's at ",
      { type: 'url', url: 'https://example.com' },
      "'",
    ]);
  });

  it('strips multiple trailing punctuation characters repeatedly', () => {
    const result = parseLogLine('See https://example.com).');
    expect(result).toStrictEqual([
      'See ',
      { type: 'url', url: 'https://example.com' },
      ').',
    ]);
  });

  it('exactly-80-char URL is handled correctly', () => {
    // 80 char URL: 'https://' (8) + 'a'.repeat(63) (63) + '.com/path' (9) = 80
    const url = 'https://' + 'a'.repeat(63) + '.com/path';
    expect(url.length).toBe(80);
    const result = parseLogLine(`Link: ${url}`);
    expect(result).toStrictEqual(['Link: ', { type: 'url', url }]);
  });

  it('URL at start of line', () => {
    const result = parseLogLine('https://example.com is the link');
    expect(result).toStrictEqual([
      { type: 'url', url: 'https://example.com' },
      ' is the link',
    ]);
  });

  it('URL in middle of line', () => {
    const result = parseLogLine('start https://example.com end');
    expect(result).toStrictEqual([
      'start ',
      { type: 'url', url: 'https://example.com' },
      ' end',
    ]);
  });

  it('URL at end of line', () => {
    const result = parseLogLine('the link is https://example.com');
    expect(result).toStrictEqual([
      'the link is ',
      { type: 'url', url: 'https://example.com' },
    ]);
  });

  it('does not include empty strings in output', () => {
    const result = parseLogLine('https://example.com');
    expect(result).toStrictEqual([{ type: 'url', url: 'https://example.com' }]);
    expect(result.every((seg) => seg !== '')).toBe(true);
  });
});

describe('formatUrlForDisplay', () => {
  it('URL <=80 chars returned unchanged', () => {
    const url = 'https://example.com/path?q=1';
    expect(formatUrlForDisplay(url)).toBe(url);
  });

  it('exactly 80 char URL returned unchanged', () => {
    const url = 'https://' + 'a'.repeat(63) + '.com/path';
    expect(url.length).toBe(80);
    expect(formatUrlForDisplay(url)).toBe(url);
  });

  it('URL >80 chars truncated to first 40 + ... + last 30', () => {
    const url = 'https://example.com/' + 'x'.repeat(80);
    expect(url.length).toBeGreaterThan(80);
    const expected = url.slice(0, 40) + '...' + url.slice(-30);
    expect(formatUrlForDisplay(url)).toBe(expected);
  });

  it('string containing only a URL that is long is truncated', () => {
    const url = 'https://' + 'b'.repeat(100) + '.com';
    const expected = url.slice(0, 40) + '...' + url.slice(-30);
    expect(formatUrlForDisplay(url)).toBe(expected);
  });
});
