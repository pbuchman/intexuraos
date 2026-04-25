/**
 * Tests for redactObject helper + SENTRY_REDACT_KEYS constant.
 */

import { describe, expect, it } from 'vitest';
import { redactObject, SENTRY_REDACT_KEYS } from '../redact.js';

describe('SENTRY_REDACT_KEYS', () => {
  it('contains the documented sensitive keys', () => {
    expect(SENTRY_REDACT_KEYS).toContain('authorization');
    expect(SENTRY_REDACT_KEYS).toContain('cookie');
    expect(SENTRY_REDACT_KEYS).toContain('set-cookie');
    expect(SENTRY_REDACT_KEYS).toContain('x-internal-auth');
    expect(SENTRY_REDACT_KEYS).toContain('apiKey');
    expect(SENTRY_REDACT_KEYS).toContain('api_key');
    expect(SENTRY_REDACT_KEYS).toContain('token');
    expect(SENTRY_REDACT_KEYS).toContain('refreshToken');
    expect(SENTRY_REDACT_KEYS).toContain('password');
    expect(SENTRY_REDACT_KEYS).toContain('githubToken');
    expect(SENTRY_REDACT_KEYS).toContain('anthropicApiKey');
    expect(SENTRY_REDACT_KEYS).toContain('openaiApiKey');
  });
});

describe('redactObject', () => {
  it('redacts shallow sensitive keys', () => {
    const input = { authorization: 'Bearer xyz', name: 'alice' };
    const result = redactObject(input);
    expect(result).toEqual({ authorization: '[REDACTED]', name: 'alice' });
  });

  it('redacts nested sensitive keys', () => {
    const input = {
      headers: { authorization: 'Bearer xyz' },
      body: { user: 'alice', password: 'secret' },
    };
    const result = redactObject(input);
    expect(result).toEqual({
      headers: { authorization: '[REDACTED]' },
      body: { user: 'alice', password: '[REDACTED]' },
    });
  });

  it('redacts sensitive keys inside arrays', () => {
    const input = [{ token: 'a' }, { token: 'b' }];
    const result = redactObject(input);
    expect(result).toEqual([{ token: '[REDACTED]' }, { token: '[REDACTED]' }]);
  });

  it('matches keys case-insensitively', () => {
    const input = { Authorization: 'a', AUTHORIZATION: 'b', APIKEY: 'c' };
    const result = redactObject(input);
    expect(result).toEqual({
      Authorization: '[REDACTED]',
      AUTHORIZATION: '[REDACTED]',
      APIKEY: '[REDACTED]',
    });
  });

  it('passes through primitives unchanged', () => {
    expect(redactObject('hello')).toBe('hello');
    expect(redactObject(42)).toBe(42);
    expect(redactObject(true)).toBe(true);
    expect(redactObject(null)).toBe(null);
    expect(redactObject(undefined)).toBe(undefined);
  });

  it('preserves null and undefined inside objects', () => {
    const input = { a: null, b: undefined, password: 'x' };
    const result = redactObject(input);
    expect(result).toEqual({ a: null, b: undefined, password: '[REDACTED]' });
  });

  it('does not mutate the original input', () => {
    const input = { authorization: 'Bearer xyz', nested: { token: 'abc' } };
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;
    redactObject(input);
    expect(input).toEqual(snapshot);
  });

  it('handles cycles inside arrays without overflow', () => {
    interface Node {
      items: unknown[];
    }
    const arr: unknown[] = [];
    const node: Node = { items: arr };
    arr.push(arr); // self-referential array
    arr.push(node); // back-reference to parent object
    expect(() => redactObject(node)).not.toThrow();
  });

  it('handles cycles by returning the same reference for cyclic nodes', () => {
    interface Cyclic {
      name: string;
      self?: Cyclic;
      password: string;
    }
    const input: Cyclic = { name: 'a', password: 'p' };
    input.self = input;
    expect(() => redactObject(input)).not.toThrow();
    const result = redactObject(input);
    expect(result.password).toBe('[REDACTED]');
  });

  it('does not redact when sensitive key holds an object value', () => {
    // Per spec: only non-object values get replaced with [REDACTED].
    // An object under a sensitive key is recursed into.
    const input = { token: { nested: 'value', password: 'secret' } };
    const result = redactObject(input);
    expect(result).toEqual({ token: { nested: 'value', password: '[REDACTED]' } });
  });

  it('preserves arrays as arrays', () => {
    const input = { items: [1, 2, 3] };
    const result = redactObject(input);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toEqual([1, 2, 3]);
  });

  it('redacts deeply nested keys (event.breadcrumbs[*].data shape)', () => {
    const input = {
      breadcrumbs: [
        { data: { authorization: 'Bearer x', other: 'ok' } },
        { data: { password: 'p' } },
      ],
    };
    const result = redactObject(input);
    expect(result).toEqual({
      breadcrumbs: [
        { data: { authorization: '[REDACTED]', other: 'ok' } },
        { data: { password: '[REDACTED]' } },
      ],
    });
  });
});
