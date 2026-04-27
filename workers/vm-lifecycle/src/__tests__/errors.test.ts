import { describe, it, expect } from 'vitest';
import { isExpectedStartupNetworkError } from '../errors.js';

describe('isExpectedStartupNetworkError', () => {
  it('returns false for non-Error values', () => {
    expect(isExpectedStartupNetworkError('string')).toBe(false);
    expect(isExpectedStartupNetworkError(42)).toBe(false);
    expect(isExpectedStartupNetworkError(null)).toBe(false);
    expect(isExpectedStartupNetworkError(undefined)).toBe(false);
    expect(isExpectedStartupNetworkError({})).toBe(false);
  });

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
  ])('returns true for Error with code %s', (code) => {
    const err = Object.assign(new Error('network error'), { code });
    expect(isExpectedStartupNetworkError(err)).toBe(true);
  });

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
  ])('returns true when error.cause is an Error with code %s', (code) => {
    const cause = Object.assign(new Error('network error'), { code });
    const wrapper = new TypeError('fetch failed');
    (wrapper as Error & { cause?: unknown }).cause = cause;
    expect(isExpectedStartupNetworkError(wrapper)).toBe(true);
  });

  it('returns false for Error with non-matching code', () => {
    const err = Object.assign(new Error('access denied'), { code: 'EACCES' });
    expect(isExpectedStartupNetworkError(err)).toBe(false);
  });

  it('returns false for Error with no code', () => {
    expect(isExpectedStartupNetworkError(new Error('plain'))).toBe(false);
  });

  it('returns true for Error with name AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isExpectedStartupNetworkError(err)).toBe(true);
  });

  it('returns true for Error with name TimeoutError', () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    expect(isExpectedStartupNetworkError(err)).toBe(true);
  });

  it('returns true when error.cause is an Error with AbortError name', () => {
    const cause = new Error('aborted');
    cause.name = 'AbortError';
    const wrapper = new TypeError('fetch failed');
    (wrapper as Error & { cause?: unknown }).cause = cause;
    expect(isExpectedStartupNetworkError(wrapper)).toBe(true);
  });

  it('returns true when error.cause is an Error with TimeoutError name', () => {
    const cause = new Error('timed out');
    cause.name = 'TimeoutError';
    const wrapper = new TypeError('fetch failed');
    (wrapper as Error & { cause?: unknown }).cause = cause;
    expect(isExpectedStartupNetworkError(wrapper)).toBe(true);
  });

  it('returns false when error.cause is non-Error', () => {
    const wrapper = new TypeError('fetch failed');
    (wrapper as Error & { cause?: unknown }).cause = 'just a string';
    expect(isExpectedStartupNetworkError(wrapper)).toBe(false);
  });

  it('returns false when error.cause is an Error without matching code/name', () => {
    const cause = Object.assign(new Error('other'), { code: 'EACCES' });
    const wrapper = new TypeError('fetch failed');
    (wrapper as Error & { cause?: unknown }).cause = cause;
    expect(isExpectedStartupNetworkError(wrapper)).toBe(false);
  });
});
