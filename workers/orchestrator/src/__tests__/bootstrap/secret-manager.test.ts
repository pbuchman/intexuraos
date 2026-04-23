import { describe, it, expect, vi } from 'vitest';
import {
  fetchGitHubKeys,
  GITHUB_APP_PRIVATE_KEY_SECRET,
  CACHE_MAX_AGE_MS,
  type SecretManagerDeps,
} from '../../bootstrap/secret-manager.js';

function makeDeps(overrides: Partial<SecretManagerDeps> = {}): SecretManagerDeps {
  return {
    existsSync: () => false,
    statSync: () => ({ mtimeMs: 0 }),
    readFileSync: () => '',
    execSync: () => Buffer.from(''),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe('fetchGitHubKeys', () => {
  it('returns the env override verbatim without touching gcloud', () => {
    const execSync = vi.fn();
    const deps = makeDeps({ execSync });
    const key = fetchGitHubKeys(
      { projectId: 'proj', cachePath: '/tmp/github-app.pem', override: 'PEM-KEY' },
      deps
    );
    expect(key).toBe('PEM-KEY');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('returns a fresh cached key without hitting gcloud', () => {
    const execSync = vi.fn();
    const deps = makeDeps({
      existsSync: () => true,
      statSync: () => ({ mtimeMs: 999_500 }),
      readFileSync: () => 'CACHED-KEY',
      now: () => 1_000_000,
      execSync,
    });
    const key = fetchGitHubKeys({ projectId: 'proj', cachePath: '/tmp/github-app.pem' }, deps);
    expect(key).toBe('CACHED-KEY');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('refetches when the cache is stale', () => {
    const execSync = vi.fn(() => 'FRESH-KEY\n');
    const deps = makeDeps({
      existsSync: () => true,
      statSync: () => ({ mtimeMs: 0 }),
      now: () => CACHE_MAX_AGE_MS + 1,
      execSync,
    });
    const key = fetchGitHubKeys({ projectId: 'proj', cachePath: '/tmp/github-app.pem' }, deps);
    expect(key).toBe('FRESH-KEY');
    expect(execSync).toHaveBeenCalledOnce();
  });

  it('fetches from Secret Manager when no cache exists', () => {
    const execSync: SecretManagerDeps['execSync'] = vi.fn(() => '  PEM-FROM-GCLOUD  \n');
    const deps = makeDeps({ execSync });
    const key = fetchGitHubKeys({ projectId: 'my-proj', cachePath: '/tmp/x.pem' }, deps);
    expect(key).toBe('PEM-FROM-GCLOUD');
    const firstCall = vi.mocked(execSync).mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toContain(GITHUB_APP_PRIVATE_KEY_SECRET);
    expect(firstCall?.[0]).toContain('my-proj');
  });

  it('throws with the secret name when Secret Manager returns 404 / errors', () => {
    const deps = makeDeps({
      execSync: () => {
        throw new Error('NOT_FOUND: secret not found');
      },
    });
    expect(() => fetchGitHubKeys({ projectId: 'proj', cachePath: '/tmp/x.pem' }, deps)).toThrow(
      new RegExp(`'${GITHUB_APP_PRIVATE_KEY_SECRET}'`)
    );
  });

  it('includes the underlying error detail in the thrown message', () => {
    const deps = makeDeps({
      execSync: () => {
        throw new Error('NOT_FOUND: secret missing');
      },
    });
    expect(() => fetchGitHubKeys({ projectId: 'proj', cachePath: '/tmp/x.pem' }, deps)).toThrow(
      /NOT_FOUND: secret missing/
    );
  });

  it('renders non-Error throwables from gcloud as strings in the thrown message', () => {
    const deps = makeDeps({
      execSync: () => {
        throw 'gcloud: permission denied';
      },
    });
    expect(() => fetchGitHubKeys({ projectId: 'proj', cachePath: '/tmp/x.pem' }, deps)).toThrow(
      /gcloud: permission denied/
    );
  });

  it('ignores an empty-string override and falls through to Secret Manager', () => {
    const execSync = vi.fn(() => 'PEM-FROM-GCLOUD');
    const deps = makeDeps({ execSync });
    const key = fetchGitHubKeys({ projectId: 'proj', cachePath: '/tmp/x.pem', override: '' }, deps);
    expect(key).toBe('PEM-FROM-GCLOUD');
    expect(execSync).toHaveBeenCalledOnce();
  });
});
