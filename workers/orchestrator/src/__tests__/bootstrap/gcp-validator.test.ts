import { describe, it, expect, vi } from 'vitest';
import { validateGcpCredentials, type GcpValidatorDeps } from '../../bootstrap/gcp-validator.js';

function makeDeps(overrides: Partial<GcpValidatorDeps> = {}): GcpValidatorDeps {
  return {
    existsSync: () => true,
    execSync: () => Buffer.from(''),
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

  it('calls gcloud with the provided key and project', () => {
    const execSync: GcpValidatorDeps['execSync'] = vi.fn(() => Buffer.from(''));
    const deps = makeDeps({ execSync });
    validateGcpCredentials('/path/sa.json', 'my-proj', deps);
    const mockFn = vi.mocked(execSync);
    const call = mockFn.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[0]).toContain('/path/sa.json');
    expect(call?.[0]).toContain('my-proj');
  });

  it('wraps gcloud failures in an error mentioning the key path', () => {
    const deps = makeDeps({
      execSync: () => {
        throw new Error('gcloud: auth failed');
      },
    });
    expect(() => validateGcpCredentials('/path/sa.json', 'proj', deps)).toThrow(
      /GCP authentication failed.*\/path\/sa\.json/
    );
  });

  it('preserves non-Error throwables from gcloud', () => {
    const deps = makeDeps({
      execSync: () => {
        throw 'bare string';
      },
    });
    expect(() => validateGcpCredentials('/path/sa.json', 'proj', deps)).toThrow(/bare string/);
  });
});
