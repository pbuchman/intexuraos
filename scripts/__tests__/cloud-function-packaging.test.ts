import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function buildWorker(workerPackage: string): void {
  execSync(`pnpm --filter ${workerPackage} build`, {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function readBuiltPackageJson(relativePath: string): { dependencies?: Record<string, string> } {
  return JSON.parse(readRepoFile(relativePath)) as { dependencies?: Record<string, string> };
}

function getCatalogVersion(depName: string): string {
  const workspaceYaml = readRepoFile('pnpm-workspace.yaml');
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workspaceYaml.match(new RegExp(`^\\s*${escaped}:\\s*(.+)$`, 'm'));

  if (!match?.[1]) {
    throw new Error(`Missing catalog entry for ${depName}`);
  }

  return match[1].trim();
}

describe('Cloud Function production package generation', () => {
  it('resolves pnpm catalog dependencies for vm-lifecycle dist/package.json', () => {
    buildWorker('@intexuraos/vm-lifecycle');

    const pkg = readBuiltPackageJson('workers/vm-lifecycle/dist/package.json');

    expect(Object.values(pkg.dependencies ?? {})).not.toContain('catalog:');
    expect(pkg.dependencies?.pino).toBe(getCatalogVersion('pino'));
  });

  it('resolves pnpm catalog dependencies for transcription dist/package.json', () => {
    buildWorker('@intexuraos/transcription');

    const pkg = readBuiltPackageJson('workers/transcription/dist/package.json');

    expect(Object.values(pkg.dependencies ?? {})).not.toContain('catalog:');
    expect(pkg.dependencies?.pino).toBe(getCatalogVersion('pino'));
  });
});
