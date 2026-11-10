import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const comparison = resolve(__dirname, '../home-prod/compare-web-releases.mjs');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { candidate: string; existing: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'home-prod-web-comparison-'));
  roots.push(root);
  const candidate = join(root, 'candidate');
  const existing = join(root, 'existing');
  for (const directory of [candidate, existing]) {
    mkdirSync(join(directory, 'assets'), { recursive: true });
    mkdirSync(join(directory, 'empty'));
    writeFileSync(join(directory, 'index.html'), '<html>same release</html>');
    writeFileSync(join(directory, 'assets', 'bundle.js'), 'same');
    symlinkSync('assets/bundle.js', join(directory, 'bundle-link'));
  }
  return { candidate, existing, root };
}

function compare(candidate: string, existing: string): number | null {
  const result = spawnSync(process.execPath, [comparison, candidate, existing], {
    encoding: 'utf8',
  });
  expect(result.stderr).toBe(
    result.status === 0 ? '' : 'Web release trees differ or cannot be inspected\n'
  );
  return result.status;
}

describe('Home PROD immutable web release comparison', () => {
  it('accepts identical content, directories and symlink targets with different timestamps', () => {
    const { candidate, existing } = fixture();
    utimesSync(join(candidate, 'index.html'), 100, 100);
    utimesSync(join(existing, 'index.html'), 200, 200);

    expect(compare(candidate, existing)).toBe(0);
  });

  it('rejects changed file content even when the size and timestamp match', () => {
    const { candidate, existing } = fixture();
    writeFileSync(join(existing, 'assets', 'bundle.js'), 'else');
    utimesSync(join(candidate, 'assets', 'bundle.js'), 100, 100);
    utimesSync(join(existing, 'assets', 'bundle.js'), 100, 100);

    expect(compare(candidate, existing)).toBe(1);
  });

  it.each(['candidate', 'existing'] as const)('rejects an extra entry in %s', (side) => {
    const paths = fixture();
    mkdirSync(join(paths[side], 'extra-empty-directory'));

    expect(compare(paths.candidate, paths.existing)).toBe(1);
  });

  it('rejects changed symlink targets even if both resolve to identical bytes', () => {
    const { candidate, existing } = fixture();
    for (const directory of [candidate, existing]) {
      writeFileSync(join(directory, 'alternate.js'), 'same');
    }
    rmSync(join(existing, 'bundle-link'));
    symlinkSync('alternate.js', join(existing, 'bundle-link'));

    expect(compare(candidate, existing)).toBe(1);
  });

  it('rejects a symlink replacing a regular file with identical bytes', () => {
    const { candidate, existing } = fixture();
    rmSync(join(existing, 'assets', 'bundle.js'));
    symlinkSync(join(candidate, 'assets', 'bundle.js'), join(existing, 'assets', 'bundle.js'));

    expect(compare(candidate, existing)).toBe(1);
  });

  it('rejects symlink roots and missing paths', () => {
    const { candidate, existing, root } = fixture();
    const link = join(root, 'linked-root');
    symlinkSync(existing, link);

    expect(compare(candidate, link)).toBe(1);
    expect(compare(candidate, join(root, 'missing'))).toBe(1);
  });

  it('rejects special filesystem entries without reading them', () => {
    const { candidate, existing } = fixture();
    for (const directory of [candidate, existing]) {
      expect(spawnSync('mkfifo', [join(directory, 'pipe')]).status).toBe(0);
    }

    expect(compare(candidate, existing)).toBe(1);
  });
});
