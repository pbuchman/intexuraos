import { describe, it, expect, vi } from 'vitest';
import { IntexuraOSError } from '@intexuraos/common-core';
import { validateGcpCredentials, type GcpValidatorDeps } from '../../bootstrap/gcp-validator.js';

function makeDeps(overrides: Partial<GcpValidatorDeps> = {}): GcpValidatorDeps {
  return {
    existsSync: () => true,
    execFileSync: () => Buffer.from('access-token'),
    ...overrides,
  };
}

describe('validateGcpCredentials', () => {
  it('throws with a clear error when the SA key file is missing', () => {
    const deps = makeDeps({ existsSync: () => false });
    expect(() => validateGcpCredentials('/missing/key.json', 'proj', deps)).toThrow(
      /GCP service account key not found at \/missing\/key\.json/
    );
  });

  it('checks a token with an isolated credential override and does not mutate global gcloud auth', () => {
    const execFileSync: GcpValidatorDeps['execFileSync'] = vi.fn(() =>
      Buffer.from('access-token-that-must-not-be-logged')
    );
    const deps = makeDeps({ execFileSync });
    validateGcpCredentials('/path/sa.json', 'my-proj', deps);
    const mockFn = vi.mocked(execFileSync);
    const call = mockFn.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[0]).toBe('gcloud');
    expect(call?.[1]).toEqual(['auth', 'print-access-token', '--project', 'my-proj']);
    expect(call?.[1]).not.toContain('activate-service-account');
    expect(call?.[2]).toMatchObject({
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: '/path/sa.json',
        CLOUDSDK_CORE_PROJECT: 'my-proj',
      },
    });
  });

  it('wraps gcloud failures in an error mentioning the key path', () => {
    const deps = makeDeps({
      execFileSync: () => {
        throw new Error('gcloud: auth failed');
      },
    });
    expect(() => validateGcpCredentials('/path/sa.json', 'proj', deps)).toThrow(
      /GCP authentication failed.*\/path\/sa\.json/
    );
  });

  it('redacts failure details from gcloud', () => {
    const sentinel = 'access-token-that-must-not-be-logged';
    const deps = makeDeps({
      execFileSync: () => {
        throw new Error(sentinel);
      },
    });
    let thrown: unknown;
    try {
      validateGcpCredentials('/path/sa.json', 'proj', deps);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IntexuraOSError);
    expect((thrown as Error).message).not.toContain(sentinel);
  });

  // INT-1565 acceptance: bootstrap failures must be typed `IntexuraOSError`s.
  it('throws an IntexuraOSError with code MISCONFIGURED on missing key', () => {
    const deps = makeDeps({ existsSync: () => false });
    try {
      validateGcpCredentials('/missing/key.json', 'proj', deps);
      throw new Error('expected validateGcpCredentials to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IntexuraOSError);
      expect((err as IntexuraOSError).code).toBe('MISCONFIGURED');
    }
  });

  it('throws an IntexuraOSError with code MISCONFIGURED on auth failure', () => {
    const deps = makeDeps({
      execFileSync: () => {
        throw new Error('gcloud: auth failed');
      },
    });
    try {
      validateGcpCredentials('/path/sa.json', 'proj', deps);
      throw new Error('expected validateGcpCredentials to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IntexuraOSError);
      expect((err as IntexuraOSError).code).toBe('MISCONFIGURED');
    }
  });
});
