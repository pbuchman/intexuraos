import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'verify-no-raw-fetch.mjs');

function writeFixture(rootDir: string, relativePath: string, body: string): void {
  const fullPath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body);
}

function runScript(rootDir: string) {
  return spawnSync('node', [SCRIPT, '--root', rootDir], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('verify-no-raw-fetch', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'verify-no-raw-fetch-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('passes when target files avoid raw fetch and non-target files still use it', () => {
    writeFixture(
      rootDir,
      'apps/bookmarks-agent/src/infra/http/client.ts',
      `
import { sendInternalRequest } from '@intexuraos/internal-clients';

export async function callApi() {
  return sendInternalRequest({ path: '/internal/example' });
}
`
    );
    writeFixture(
      rootDir,
      'apps/other-service/src/http/client.ts',
      `
export async function stillAllowedOutsideScope() {
  return fetch('https://example.com');
}
`
    );

    const result = runScript(rootDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/No raw internal fetch calls found/);
  });

  it('fails when a scoped adapter uses raw fetch', () => {
    writeFixture(
      rootDir,
      'apps/bookmarks-agent/src/infra/http/bad.ts',
      `
export async function bad() {
  return fetch('https://example.com/internal');
}
`
    );

    const result = runScript(rootDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/raw fetch\(\) is forbidden here/);
    expect(result.stderr).toMatch(/apps\/bookmarks-agent\/src\/infra\/http\/bad\.ts:3/);
  });

  it('fails when any app infra file uses raw fetch outside the migrated client directories', () => {
    writeFixture(
      rootDir,
      'apps/code-agent/src/infra/services/badDispatcher.ts',
      `
export async function dispatch(url: string) {
  return fetch(url);
}
`
    );

    const result = runScript(rootDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/raw fetch\(\) is forbidden here/);
    expect(result.stderr).toMatch(/apps\/code-agent\/src\/infra\/services\/badDispatcher\.ts:3/);
  });

  it('ignores comment and string literals that mention fetch', () => {
    writeFixture(
      rootDir,
      'apps/research-agent/src/infra/usage/client.ts',
      `
export function safe() {
  const sample = "fetch('https://example.com')";
  // fetch('https://example.com/commented')
  return sample;
}
`
    );

    const result = runScript(rootDir);
    expect(result.status).toBe(0);
  });

  it('passes against the real repo files', () => {
    const output = execFileSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(output).toMatch(/No raw internal fetch calls found/);
  });
});
