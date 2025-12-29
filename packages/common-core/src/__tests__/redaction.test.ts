/**
 * Tests for redaction utilities.
 */
import { describe, it, expect } from 'vitest';
import { redactToken, redactObject, SENSITIVE_FIELDS } from '../redaction.js';

describe('Redaction utilities', () => {
  describe('redactToken', () => {
    it('returns [empty] for undefined', () => {
      expect(redactToken(undefined)).toBe('[empty]');
    });

    it('returns [empty] for null', () => {
      expect(redactToken(null)).toBe('[empty]');
    });

    it('returns [empty] for empty string', () => {
      expect(redactToken('')).toBe('[empty]');
    });

    it('returns [REDACTED] for short token (12 chars or less)', () => {
      expect(redactToken('123456789012')).toBe('[REDACTED]');
      expect(redactToken('short')).toBe('[REDACTED]');
      expect(redactToken('a')).toBe('[REDACTED]');
    });

    it('returns [REDACTED] for exactly 12 character token', () => {
      expect(redactToken('abcdefghijkl')).toBe('[REDACTED]');
    });

    it('shows first 4 and last 4 chars for token > 12 chars', () => {
      // Token: "1234567890abcdefghij" (20 chars)
      expect(redactToken('1234567890abcdefghij')).toBe('1234...ghij');
    });

    it('shows first 4 and last 4 chars for 13 character token', () => {
      // Token: "1234567890abc" (13 chars)
      expect(redactToken('1234567890abc')).toBe('1234...0abc');
    });

    it('handles typical JWT token format', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123';
      const redacted = redactToken(jwt);
      expect(redacted).toBe('eyJh...e123');
    });

    it('handles API key format', () => {
      const apiKey = 'test_key_1234567890abcdefghijklmnop';
      const redacted = redactToken(apiKey);
      expect(redacted).toBe('test...mnop');
    });
  });

  describe('redactObject', () => {
    it('returns copy with sensitive string fields redacted', () => {
      const obj = {
        username: 'john',
        password: 'secret123password',
        token: 'bearer-token-12345678',
      };

      const redacted = redactObject(obj, ['password', 'token']);

      expect(redacted['username']).toBe('john');
      expect(redacted['password']).toBe('secr...word');
      expect(redacted['token']).toBe('bear...5678');
    });

    it('does not modify original object', () => {
      const obj = {
        password: 'originalpassword123',
      };

      redactObject(obj, ['password']);

      expect(obj.password).toBe('originalpassword123');
    });

    it('handles missing sensitive fields gracefully', () => {
      const obj = {
        username: 'john',
      };

      const redacted = redactObject(obj, ['password', 'token']);

      expect(redacted['username']).toBe('john');
      expect(redacted).not.toHaveProperty('password');
      expect(redacted).not.toHaveProperty('token');
    });

    it('does not redact non-string sensitive fields', () => {
      const obj = {
        token: 12345,
        password: { hash: 'abc' },
        secret: ['a', 'b', 'c'],
      };

      const redacted = redactObject(obj, ['token', 'password', 'secret']);

      // Non-string values should not be modified
      expect(redacted['token']).toBe(12345);
      expect(redacted['password']).toEqual({ hash: 'abc' });
      expect(redacted['secret']).toEqual(['a', 'b', 'c']);
    });

    it('handles empty sensitive fields array', () => {
      const obj = {
        password: 'secret123password',
      };

      const redacted = redactObject(obj, []);

      expect(redacted['password']).toBe('secret123password');
    });

    it('handles empty object', () => {
      const redacted = redactObject({}, ['password']);
      expect(redacted).toEqual({});
    });

    it('redacts short string values correctly', () => {
      const obj = {
        token: 'short',
      };

      const redacted = redactObject(obj, ['token']);

      expect(redacted['token']).toBe('[REDACTED]');
    });
  });

  describe('SENSITIVE_FIELDS', () => {
    it('contains expected sensitive field names', () => {
      expect(SENSITIVE_FIELDS).toContain('password');
      expect(SENSITIVE_FIELDS).toContain('token');
      expect(SENSITIVE_FIELDS).toContain('access_token');
      expect(SENSITIVE_FIELDS).toContain('refresh_token');
      expect(SENSITIVE_FIELDS).toContain('id_token');
      expect(SENSITIVE_FIELDS).toContain('device_code');
      expect(SENSITIVE_FIELDS).toContain('authorization');
      expect(SENSITIVE_FIELDS).toContain('secret');
      expect(SENSITIVE_FIELDS).toContain('api_key');
      expect(SENSITIVE_FIELDS).toContain('apiKey');
      expect(SENSITIVE_FIELDS).toContain('client_secret');
      expect(SENSITIVE_FIELDS).toContain('clientSecret');
    });

    it('is a readonly array', () => {
      // TypeScript enforces this at compile time via `as const`
      // At runtime, we can verify it's an array
      expect(Array.isArray(SENSITIVE_FIELDS)).toBe(true);
      expect(SENSITIVE_FIELDS.length).toBeGreaterThan(0);
    });
  });
});
