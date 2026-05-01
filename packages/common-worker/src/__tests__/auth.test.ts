/**
 * Tests for verifyInternalAuth.
 *
 * Contract:
 * - Raw token comparison via `timingSafeEqual` (no `Bearer ` prefix accepted —
 *   `vm-lifecycle` historically did, that's the bug we're fixing).
 * - `expectedToken` undefined / empty → false (config bug is a 401, not a
 *   bypass).
 * - Header may arrive as string | string[] | undefined (Cloud Functions vs
 *   Express); the array form takes its first element.
 * - Unequal-length strings return false WITHOUT throwing — `timingSafeEqual`
 *   would throw, so the wrapper must guard with a length check first.
 */
import { describe, expect, it } from 'vitest';
import { verifyInternalAuth } from '../auth.js';

describe('verifyInternalAuth', () => {
  it('returns true for matching raw token', () => {
    expect(verifyInternalAuth('secret', 'secret')).toBe(true);
  });

  it('rejects Bearer-prefixed tokens (the bug being fixed)', () => {
    expect(verifyInternalAuth('Bearer secret', 'secret')).toBe(false);
  });

  it('returns false when expected token is undefined', () => {
    expect(verifyInternalAuth('secret', undefined)).toBe(false);
  });

  it('returns false when expected token is empty', () => {
    expect(verifyInternalAuth('secret', '')).toBe(false);
  });

  it('returns false when header is undefined', () => {
    expect(verifyInternalAuth(undefined, 'secret')).toBe(false);
  });

  it('returns false when header is empty string', () => {
    expect(verifyInternalAuth('', 'secret')).toBe(false);
  });

  it('uses first element of an array header', () => {
    expect(verifyInternalAuth(['secret', 'other'], 'secret')).toBe(true);
  });

  it('returns false when first element of array header does not match', () => {
    expect(verifyInternalAuth(['nope', 'secret'], 'secret')).toBe(false);
  });

  it('returns false when array header is empty', () => {
    expect(verifyInternalAuth([], 'secret')).toBe(false);
  });

  it('returns false for unequal-length strings without throwing', () => {
    expect(verifyInternalAuth('s', 'secret')).toBe(false);
  });

  it('returns false for equal-length strings that differ', () => {
    expect(verifyInternalAuth('abcdef', 'abcdeg')).toBe(false);
  });
});
