import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const verifier = resolve(repoRoot, 'scripts/home-prod/verify-secret-package-version-pins.mjs');
const temporaryDirectories: string[] = [];

function manifest(contents: unknown): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'intexuraos-version-pin-'));
  temporaryDirectories.push(directory);
  const path = resolve(directory, 'secret-packages.json');
  writeFileSync(path, typeof contents === 'string' ? contents : `${JSON.stringify(contents)}\n`);
  return path;
}

function verify(version: string, path: string) {
  return spawnSync(process.execPath, [verifier, version, path], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('PROD secret-package version reconciliation', () => {
  it('accepts one exact positive version shared by deployment and the package manifest', () => {
    const result = verify(
      '17',
      manifest({ schemaVersion: 1, packages: { prod: { stableVersion: 17 } } })
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      environment: 'prod',
      status: 'MATCH',
      version: '17',
    });
  });

  it.each([
    ['latest', 17],
    ['01', 1],
    ['17', 18],
  ])('rejects invalid or mismatched input %s against manifest %s', (version, stableVersion) => {
    const result = verify(
      version,
      manifest({ schemaVersion: 1, packages: { prod: { stableVersion } } })
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('SECRET_PACKAGE_VERSION_PINS_MISMATCH\n');
  });

  it.each([
    ['malformed manifest', '{'],
    ['missing manifest pin', { schemaVersion: 1, packages: { prod: {} } }],
    ['wrong schema', { schemaVersion: 2, packages: { prod: { stableVersion: 17 } } }],
  ])('fails closed for %s', (_name, contents) => {
    const result = verify('17', manifest(contents));
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('SECRET_PACKAGE_VERSION_PINS_MISMATCH\n');
  });
});
