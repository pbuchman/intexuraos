import { describe, it, expect } from 'vitest';
import { redactToken, redactObject, SENSITIVE_FIELDS } from '../redaction.js';

describe('redactToken', () => {
  it('should redact tokens longer than 12 characters showing first and last 4', () => {
    const longToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9';
    const redacted = redactToken(longToken);
    expect(redacted).toBe('eyJh...VCJ9');
  });

  it('should redact short tokens (<=12 chars) completely', () => {
    expect(redactToken('short123')).toBe('[REDACTED]');
    expect(redactToken('abc')).toBe('[REDACTED]');
  });

  it('should handle null by returning "[empty]"', () => {
    expect(redactToken(null)).toBe('[empty]');
  });

  it('should handle undefined by returning "[empty]"', () => {
    expect(redactToken(undefined)).toBe('[empty]');
  });

  it('should handle empty string by returning "[empty]"', () => {
    expect(redactToken('')).toBe('[empty]');
  });

  it('should handle exactly 12 character strings', () => {
    expect(redactToken('exactly12chr')).toBe('[REDACTED]');
  });

  it('should handle 13 character strings (just above threshold)', () => {
    const token = '1234567890123';
    expect(redactToken(token)).toBe('1234...0123');
  });
});

describe('redactObject', () => {
  it('should redact specified sensitive fields', () => {
    const data = {
      username: 'john',
      access_token: 'secret-token-value',
      email: 'john@example.com',
    };
    const redacted = redactObject(data, ['access_token']);
    expect(redacted['username']).toBe('john');
    expect(redacted['access_token']).toBe('secr...alue');
    expect(redacted['email']).toBe('john@example.com');
  });

  it('should redact multiple sensitive fields', () => {
    const data = {
      access_token: 'access-token-value',
      refresh_token: 'refresh-token-value',
      user: 'john',
    };
    const redacted = redactObject(data, ['access_token', 'refresh_token']);
    expect(redacted['access_token']).toBe('acce...alue');
    expect(redacted['refresh_token']).toBe('refr...alue');
    expect(redacted['user']).toBe('john');
  });

  it('should skip fields that are not strings', () => {
    const data = {
      access_token: 123,
      refresh_token: null,
      id_token: undefined,
    };
    const redacted = redactObject(data, ['access_token', 'refresh_token', 'id_token']);
    expect(redacted['access_token']).toBe(123);
    expect(redacted['refresh_token']).toBe(null);
    expect(redacted['id_token']).toBe(undefined);
  });

  it('should not modify fields that are not in sensitive list', () => {
    const data = {
      username: 'john',
      password: 'secret-password',
    };
    const redacted = redactObject(data, ['password']);
    expect(redacted['username']).toBe('john');
    expect(redacted['password']).toBe('secr...word');
  });

  it('should handle empty object', () => {
    const data = {};
    const redacted = redactObject(data, ['access_token']);
    expect(redacted).toEqual({});
  });

  it('should handle missing sensitive fields', () => {
    const data = { username: 'john' };
    const redacted = redactObject(data, ['access_token', 'password']);
    expect(redacted).toEqual({ username: 'john' });
  });
});

describe('SENSITIVE_FIELDS', () => {
  it('should contain common sensitive field names', () => {
    expect(SENSITIVE_FIELDS).toContain('password');
    expect(SENSITIVE_FIELDS).toContain('access_token');
    expect(SENSITIVE_FIELDS).toContain('refresh_token');
    expect(SENSITIVE_FIELDS).toContain('id_token');
    expect(SENSITIVE_FIELDS).toContain('device_code');
    expect(SENSITIVE_FIELDS).toContain('client_secret');
  });
});
