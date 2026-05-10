import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyMigrations } from '../verify-migrations.mjs'; // @allow-missing-js -- .mjs import

function createTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'verify-migrations-'));
  mkdirSync(join(root, 'migrations'), { recursive: true });
  return root;
}

function writeMigration(root: string, id: string, name: string, extra = ''): void {
  writeFileSync(
    join(root, 'migrations', `${id}_${name}.mjs`),
    `export const metadata = {
  id: '${id}',
  name: '${name}',
  description: 'fixture migration'
};

export async function up() {}
${extra}
`
  );
}

function calculateManifestChecksum(bytes: string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function writeManifest(
  root: string,
  entries: Array<{ id: string; name: string; checksum: string }>,
  lastReservedId: string
): void {
  writeFileSync(
    join(root, 'migrations', 'manifest.json'),
    JSON.stringify({ lastReservedId, entries }, null, 2) + '\n'
  );
}

describe('verifyMigrations', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root !== undefined) {
        rmSync(root, { recursive: true, force: true });
      }
    }
    vi.restoreAllMocks();
  });

  function setup(): string {
    const root = createTempRepo();
    tempRoots.push(root);
    return root;
  }

  it('fails when a manifest checksum does not match a committed migration file', async () => {
    const root = setup();
    writeMigration(root, '001', 'first');
    writeMigration(root, '002', 'second');

    const firstBytes = readFileSync(join(root, 'migrations', '001_first.mjs'), 'utf8');
    const secondBytes = readFileSync(join(root, 'migrations', '002_second.mjs'), 'utf8');

    writeManifest(
      root,
      [
        { id: '001', name: 'first', checksum: calculateManifestChecksum(firstBytes) },
        { id: '002', name: 'second', checksum: 'sha256:deadbeef' },
      ],
      '002'
    );

    const result = await verifyMigrations({ repoRoot: root });

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('002_second.mjs')])
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('checksums differ')])
    );
    expect(result.exitCode).toBe(1);
    expect(secondBytes).toContain('export async function up() {}');
  });

  it('allows exactly one new migration when it is lastReservedId plus one', async () => {
    const root = setup();
    writeMigration(root, '001', 'first');
    writeMigration(root, '002', 'second');
    writeMigration(root, '003', 'third');

    const firstBytes = readFileSync(join(root, 'migrations', '001_first.mjs'), 'utf8');
    const secondBytes = readFileSync(join(root, 'migrations', '002_second.mjs'), 'utf8');

    writeManifest(
      root,
      [
        { id: '001', name: 'first', checksum: calculateManifestChecksum(firstBytes) },
        { id: '002', name: 'second', checksum: calculateManifestChecksum(secondBytes) },
      ],
      '002'
    );

    const result = await verifyMigrations({ repoRoot: root });

    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('fails when a new migration skips ahead of lastReservedId plus one', async () => {
    const root = setup();
    writeMigration(root, '001', 'first');
    writeMigration(root, '004', 'skipped');

    const firstBytes = readFileSync(join(root, 'migrations', '001_first.mjs'), 'utf8');

    writeManifest(
      root,
      [{ id: '001', name: 'first', checksum: calculateManifestChecksum(firstBytes) }],
      '001'
    );

    const result = await verifyMigrations({ repoRoot: root });

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('lastReservedId+1=002')])
    );
    expect(result.exitCode).toBe(1);
  });

  it('fails when migrations contains a malformed .mjs filename', async () => {
    const root = setup();
    writeMigration(root, '001', 'first');
    writeFileSync(
      join(root, 'migrations', 'not-a-migration.mjs'),
      "export const metadata = { id: '999', name: 'bad' };\nexport async function up() {}\n"
    );

    const firstBytes = readFileSync(join(root, 'migrations', '001_first.mjs'), 'utf8');
    writeManifest(
      root,
      [{ id: '001', name: 'first', checksum: calculateManifestChecksum(firstBytes) }],
      '001'
    );

    const result = await verifyMigrations({ repoRoot: root });

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Invalid filename: not-a-migration.mjs')])
    );
    expect(result.exitCode).toBe(1);
  });
});
