/**
 * Tests for loadEnv typed environment variable reader.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../loadEnv.js';

describe('loadEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns typed record when all keys are present and non-empty', () => {
    process.env['A_URL'] = 'https://a';
    process.env['B_TOKEN'] = 'tok';
    const result = loadEnv(['A_URL', 'B_TOKEN'] as const);
    expect(result).toEqual({ A_URL: 'https://a', B_TOKEN: 'tok' });
    // Compile-time: result.A_URL is string, not string | undefined
    const a: string = result.A_URL;
    expect(a).toBe('https://a');
  });

  it('returns empty record for empty key list', () => {
    const result = loadEnv([] as const);
    expect(result).toEqual({});
  });

  it('throws when a key is missing', () => {
    delete process.env['MISSING_VAR'];
    expect(() => loadEnv(['MISSING_VAR'] as const)).toThrow(
      /Missing required environment variables: MISSING_VAR/
    );
  });

  it('throws when a key is empty string', () => {
    process.env['EMPTY_VAR'] = '';
    expect(() => loadEnv(['EMPTY_VAR'] as const)).toThrow(
      /Missing required environment variables: EMPTY_VAR/
    );
  });

  it('lists all missing keys in the thrown error', () => {
    delete process.env['LOAD_ENV_A'];
    process.env['LOAD_ENV_B'] = '';
    expect(() => loadEnv(['LOAD_ENV_A', 'LOAD_ENV_B'] as const)).toThrow(
      /LOAD_ENV_A, LOAD_ENV_B/
    );
  });

  it('mentions Terraform and .envrc.local in the error message', () => {
    delete process.env['LOAD_ENV_HINT'];
    expect(() => loadEnv(['LOAD_ENV_HINT'] as const)).toThrow(/Terraform/);
    expect(() => loadEnv(['LOAD_ENV_HINT'] as const)).toThrow(/\.envrc\.local/);
  });
});
