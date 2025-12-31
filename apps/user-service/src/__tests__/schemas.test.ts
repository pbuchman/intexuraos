/**
 * Tests for schema utilities
 */
import { describe, expect, it } from 'vitest';
import { isAuth0Error } from '../routes/schemas.js';

describe('isAuth0Error', () => {
  it('returns false for null', () => {
    expect(isAuth0Error(null)).toBe(false);
  });

  it('returns false for non-object primitives', () => {
    expect(isAuth0Error('string')).toBe(false);
    expect(isAuth0Error(123)).toBe(false);
    expect(isAuth0Error(undefined)).toBe(false);
  });

  it('returns false for object without error property', () => {
    expect(isAuth0Error({ message: 'test' })).toBe(false);
  });

  it('returns false when error property is not a string', () => {
    expect(isAuth0Error({ error: 123 })).toBe(false);
    expect(isAuth0Error({ error: null })).toBe(false);
  });

  it('returns true for valid Auth0 error response', () => {
    expect(isAuth0Error({ error: 'invalid_grant' })).toBe(true);
    expect(
      isAuth0Error({
        error: 'access_denied',
        error_description: 'The user denied the request',
      })
    ).toBe(true);
  });
});
