import { describe, expect, it } from 'vitest';
import { IntexuraOSError } from '@intexuraos/common-core';
import {
  fetchGitHubKeys,
  GITHUB_APP_PRIVATE_KEY_PATH,
  type SecretManagerDeps,
} from '../../bootstrap/secret-manager.js';

function makeDeps(overrides: Partial<SecretManagerDeps> = {}): SecretManagerDeps {
  return {
    existsSync: () => true,
    statSync: () => ({ mode: 0o100600 }),
    readFileSync: () => '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
    ...overrides,
  };
}

describe('fetchGitHubKeys', () => {
  it('loads the host-rendered package file without invoking Secret Manager', () => {
    const key = fetchGitHubKeys(
      { privateKeyPath: '/run/intexuraos/dev/current/github-app-private-key.pem' },
      makeDeps()
    );

    expect(key).toContain('BEGIN PRIVATE KEY');
    expect(GITHUB_APP_PRIVATE_KEY_PATH).toBe('INTEXURAOS_GITHUB_APP_PRIVATE_KEY_PATH');
  });

  it('fails closed when the package projection does not exist', () => {
    expect(() =>
      fetchGitHubKeys(
        { privateKeyPath: '/run/intexuraos/dev/current/github-app-private-key.pem' },
        makeDeps({ existsSync: () => false })
      )
    ).toThrow(/rendered GitHub App private key file is missing/iu);
  });

  it('rejects a private-key projection with group or world permissions', () => {
    expect(() =>
      fetchGitHubKeys(
        { privateKeyPath: '/run/intexuraos/dev/current/github-app-private-key.pem' },
        makeDeps({ statSync: () => ({ mode: 0o100640 }) })
      )
    ).toThrow(/mode 0600/iu);
  });

  it('rejects a malformed rendered private key', () => {
    expect(() =>
      fetchGitHubKeys(
        { privateKeyPath: '/run/intexuraos/dev/current/github-app-private-key.pem' },
        makeDeps({ readFileSync: () => 'not-a-private-key' })
      )
    ).toThrow(/valid PEM private key/iu);
  });

  it('redacts filesystem read error details', () => {
    const sentinel = 'private-value-that-must-not-be-logged';
    let thrown: unknown;

    try {
      fetchGitHubKeys(
        { privateKeyPath: '/run/intexuraos/dev/current/github-app-private-key.pem' },
        makeDeps({
          readFileSync: () => {
            throw new Error(sentinel);
          },
        })
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IntexuraOSError);
    expect((thrown as IntexuraOSError).code).toBe('MISCONFIGURED');
    expect((thrown as Error).message).not.toContain(sentinel);
  });
});
