import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const deployScript = resolve(repoRoot, 'scripts', 'install-dev-static-web.sh');
const releaseSha = '1234567890abcdef1234567890abcdef12345678';

function createFixture(): { repo: string; webRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'home-dev-static-deploy-'));
  const repo = join(root, 'repo');
  const dist = join(repo, 'apps', 'web', 'dist');
  const webRoot = join(root, 'web-root');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<div id="root"></div>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("safe")');
  return { repo, webRoot };
}

function runDeploy(repo: string, webRoot: string) {
  return spawnSync('bash', [deployScript, releaseSha], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEV_WEB_OWNER: 'skip',
      DEV_WEB_ROOT: webRoot,
      NODE_BIN: process.execPath,
      REPO_DIR: repo,
    },
  });
}

describe('Home Dev static web installer', () => {
  it('publishes a Caddy-readable exact-SHA release through an atomic current symlink', () => {
    const { repo, webRoot } = createFixture();

    const result = runDeploy(repo, webRoot);

    expect(result.status, result.stderr).toBe(0);
    const current = join(webRoot, 'current');
    const release = join(webRoot, 'releases', releaseSha);
    expect(lstatSync(current).isSymbolicLink()).toBe(true);
    expect(readlinkSync(current)).toBe(release);
    expect(readFileSync(join(current, 'index.html'), 'utf8')).toContain('id="root"');
    expect(statSync(release).mode & 0o777).toBe(0o750);
    expect(statSync(join(release, 'index.html')).mode & 0o777).toBe(0o640);
    expect(statSync(join(release, 'assets')).mode & 0o777).toBe(0o750);
    expect(statSync(join(release, 'assets', 'app.js')).mode & 0o777).toBe(0o640);
  });

  it('replaces an exact-SHA release without retaining stale files', () => {
    const { repo, webRoot } = createFixture();
    expect(runDeploy(repo, webRoot).status).toBe(0);
    writeFileSync(join(webRoot, 'releases', releaseSha, 'stale.txt'), 'stale');

    const result = runDeploy(repo, webRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(() => statSync(join(webRoot, 'current', 'stale.txt'))).toThrow();
  });

  it('rejects an invalid release SHA before publishing', () => {
    const { repo, webRoot } = createFixture();
    const result = spawnSync('bash', [deployScript, 'development'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DEV_WEB_OWNER: 'skip',
        DEV_WEB_ROOT: webRoot,
        NODE_BIN: process.execPath,
        REPO_DIR: repo,
      },
    });

    expect(result.status).not.toBe(0);
  });
});
