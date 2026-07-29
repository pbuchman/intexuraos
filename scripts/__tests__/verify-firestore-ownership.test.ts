/**
 * Tests for verify-firestore-ownership script.
 *
 * These tests use temp directories with hand-crafted firestore-collections.json,
 * firestore.indexes.json, and a couple of fake apps/workers source files. They
 * exercise the exported `runOwnershipCheck({ repoRoot })` function and assert
 * on the returned `{ violations, warnings, exitCode }` shape plus captured
 * console output.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runOwnershipCheck } from '../verify-firestore-ownership.mjs'; // @allow-missing-js -- .mjs import

function setupTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'verify-firestore-'));
  mkdirSync(join(root, 'apps'), { recursive: true });
  mkdirSync(join(root, 'workers'), { recursive: true });
  return root;
}

function writeRegistry(root: string, collections: Record<string, unknown>): void {
  writeFileSync(join(root, 'firestore-collections.json'), JSON.stringify({ collections }, null, 2));
}

function writeIndexes(root: string, payload: unknown): void {
  writeFileSync(join(root, 'firestore.indexes.json'), JSON.stringify(payload, null, 2));
}

function writeFile(root: string, relPath: string, contents: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}

describe('runOwnershipCheck', () => {
  let tempRoots: string[] = [];

  beforeEach(() => {
    tempRoots = [];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function setup(): string {
    const root = setupTempRepo();
    tempRoots.push(root);
    return root;
  }

  it('honors per-collection scanPaths', () => {
    const root = setup();
    writeRegistry(root, {
      foo_collection: {
        owner: 'svc-a',
        description: 'foo',
        scanPaths: ['apps/svc-a/extra'],
      },
    });
    writeIndexes(root, { indexes: [], fieldOverrides: [] });
    // No file in default firestore dir; reference lives only in the extra path
    writeFile(root, 'apps/svc-a/extra/foo.ts', "const FOO_COLLECTION = 'foo_collection';\n");

    const result = runOwnershipCheck({ repoRoot: root });

    expect(result.violations).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('scans production js, mjs, cjs, and ts files for registry-known object-map literals', () => {
    const root = setup();
    writeRegistry(root, {
      archive_js: { owner: 'svc-a', description: 'js', scanPaths: ['apps/svc-a/ports'] },
      archive_mjs: { owner: 'svc-a', description: 'mjs', scanPaths: ['apps/svc-a/ports'] },
      archive_cjs: { owner: 'svc-a', description: 'cjs', scanPaths: ['apps/svc-a/ports'] },
      archive_ts: { owner: 'svc-a', description: 'ts', scanPaths: ['apps/svc-a/ports'] },
    });
    writeIndexes(root, { indexes: [], fieldOverrides: [] });
    writeFile(
      root,
      'apps/svc-a/ports/archive.js',
      "export const ARCHIVE_COLLECTIONS = { value: 'archive_js' };\n"
    );
    writeFile(
      root,
      'apps/svc-a/ports/archive.mjs',
      "export const ARCHIVE_COLLECTIONS = {\n  value:\n    'archive_mjs',\n};\n"
    );
    writeFile(
      root,
      'apps/svc-a/ports/archive.cjs',
      "const ARCHIVE_COLLECTIONS = { value: 'archive_cjs' };\n"
    );
    writeFile(
      root,
      'apps/svc-a/ports/archive.ts',
      "export const ARCHIVE_COLLECTIONS = { value: 'archive_ts' };\n"
    );

    const result = runOwnershipCheck({ repoRoot: root });

    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.stats.files).toBe(4);
    expect(result.stats.references).toBe(4);
  });

  it('blocks a cross-owner registry literal in an mjs migration port', () => {
    const root = setup();
    writeRegistry(root, {
      owned_by_a: { owner: 'svc-a', description: 'a' },
      migration_state: {
        owner: 'svc-b',
        description: 'b',
        scanPaths: ['apps/svc-b/migration'],
      },
    });
    writeIndexes(root, { indexes: [], fieldOverrides: [] });
    writeFile(
      root,
      'apps/svc-b/migration/ports.mjs',
      "export const collections = { foreign: 'owned_by_a', own: 'migration_state' };\n"
    );

    const result = runOwnershipCheck({ repoRoot: root });

    expect(result.exitCode).toBe(1);
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        type: 'CROSS_SERVICE',
        collection: 'owned_by_a',
        owner: 'svc-a',
        violator: 'svc-b',
        file: 'apps/svc-b/migration/ports.mjs',
      })
    );
  });

  it('excludes tests, dist, and node_modules from declared scan paths', () => {
    const root = setup();
    writeRegistry(root, {
      production_collection: {
        owner: 'svc-a',
        description: 'production',
        scanPaths: ['apps/svc-a/ports'],
      },
      test_only_collection: { owner: 'svc-a', description: 'test only' },
      dist_only_collection: { owner: 'svc-a', description: 'dist only' },
      dependency_only_collection: { owner: 'svc-a', description: 'dependency only' },
    });
    writeIndexes(root, { indexes: [], fieldOverrides: [] });
    writeFile(
      root,
      'apps/svc-a/ports/live.mjs',
      "export const COLLECTIONS = { value: 'production_collection' };\n"
    );
    writeFile(root, 'apps/svc-a/ports/live.test.mjs', "const name = 'test_only_collection';\n");
    writeFile(
      root,
      'apps/svc-a/ports/__tests__/fixture.ts',
      "const name = 'test_only_collection';\n"
    );
    writeFile(root, 'apps/svc-a/ports/dist/bundle.js', "const name = 'dist_only_collection';\n");
    writeFile(
      root,
      'apps/svc-a/ports/node_modules/package/index.cjs',
      "const name = 'dependency_only_collection';\n"
    );

    const result = runOwnershipCheck({ repoRoot: root });

    expect(result.violations).toEqual([]);
    expect(result.stats.files).toBe(1);
    expect(result.stats.references).toBe(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('test_only_collection'),
        expect.stringContaining('dist_only_collection'),
        expect.stringContaining('dependency_only_collection'),
      ])
    );
  });

  it('emits ORPHAN_INDEX violation for unknown collectionGroup in indexes', () => {
    const root = setup();
    writeRegistry(root, {
      known: { owner: 'svc-a', description: 'known' },
    });
    writeIndexes(root, {
      indexes: [
        {
          collectionGroup: 'orphan_x',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'a', order: 'ASCENDING' },
            { fieldPath: 'b', order: 'DESCENDING' },
          ],
        },
      ],
      fieldOverrides: [],
    });
    mkdirSync(join(root, 'apps/svc-a/src/infra/firestore'), { recursive: true });

    const result = runOwnershipCheck({ repoRoot: root });

    const orphanViolations = result.violations.filter((v) => v.type === 'ORPHAN_INDEX');
    expect(orphanViolations.length).toBeGreaterThan(0);
    expect(orphanViolations[0]?.collection).toBe('orphan_x');
    expect(orphanViolations[0]?.source).toBe('indexes');
    expect(result.exitCode).toBe(1);
  });

  it('treats subcollections as registered (no ORPHAN_INDEX)', () => {
    const root = setup();
    writeRegistry(root, {
      parent: {
        owner: 'svc-a',
        description: 'parent',
        subcollections: ['nested'],
      },
    });
    writeIndexes(root, {
      indexes: [
        {
          collectionGroup: 'nested',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'a', order: 'ASCENDING' },
            { fieldPath: 'b', order: 'DESCENDING' },
          ],
        },
      ],
      fieldOverrides: [],
    });
    mkdirSync(join(root, 'apps/svc-a/src/infra/firestore'), { recursive: true });
    writeFile(root, 'apps/svc-a/src/infra/firestore/x.ts', "const COLL = 'parent';\n");

    const result = runOwnershipCheck({ repoRoot: root });

    const orphanViolations = result.violations.filter((v) => v.type === 'ORPHAN_INDEX');
    expect(orphanViolations).toEqual([]);
  });

  it('treats indexCollectionGroups aliases as registered (no ORPHAN_INDEX)', () => {
    const root = setup();
    writeRegistry(root, {
      svc_a_events: {
        owner: 'svc-a',
        description: 'events',
        indexCollectionGroups: ['svc-a-events', 'svc_a_events'],
      },
    });
    writeIndexes(root, {
      indexes: [
        {
          collectionGroup: 'svc-a-events',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'a', order: 'ASCENDING' },
            { fieldPath: 'b', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'svc_a_events',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'c', order: 'ASCENDING' },
            { fieldPath: 'd', order: 'DESCENDING' },
          ],
        },
      ],
      fieldOverrides: [],
    });
    mkdirSync(join(root, 'apps/svc-a/src/infra/firestore'), { recursive: true });
    writeFile(root, 'apps/svc-a/src/infra/firestore/x.ts', "const COLL = 'svc_a_events';\n");

    const result = runOwnershipCheck({ repoRoot: root });

    const orphanViolations = result.violations.filter((v) => v.type === 'ORPHAN_INDEX');
    expect(orphanViolations).toEqual([]);
  });

  it('scans workers/<owner>/src/ for code references', () => {
    const root = setup();
    writeRegistry(root, {
      worker_collection: {
        owner: 'orchestrator-worker',
        description: 'worker collection',
      },
    });
    writeIndexes(root, { indexes: [], fieldOverrides: [] });
    writeFile(
      root,
      'workers/orchestrator-worker/src/foo.ts',
      "const COLL = 'worker_collection';\n"
    );

    const result = runOwnershipCheck({ repoRoot: root });

    const undeclared = result.violations.filter((v) => v.type === 'UNDECLARED');
    expect(undeclared).toEqual([]);
  });

  it('warns on dead registry rows but does not fail exit code', () => {
    const root = setup();
    writeRegistry(root, {
      ghost_collection: {
        owner: 'svc-a',
        description: 'no code references anywhere',
      },
    });
    writeIndexes(root, { indexes: [], fieldOverrides: [] });
    mkdirSync(join(root, 'apps/svc-a/src/infra/firestore'), { recursive: true });

    const result = runOwnershipCheck({ repoRoot: root });

    expect(result.warnings.some((w) => w.includes('ghost_collection'))).toBe(true);
    expect(result.violations.length).toBe(0);
    expect(result.exitCode).toBe(0);
  });

  it('exits non-zero when a dead collectionGroup is re-introduced', () => {
    const root = setup();
    writeRegistry(root, {
      live_collection: {
        owner: 'svc-a',
        description: 'live',
      },
    });
    writeIndexes(root, {
      indexes: [
        {
          collectionGroup: 'compositeFeeds',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'updatedAt', order: 'DESCENDING' },
          ],
        },
      ],
      fieldOverrides: [],
    });
    mkdirSync(join(root, 'apps/svc-a/src/infra/firestore'), { recursive: true });
    writeFile(root, 'apps/svc-a/src/infra/firestore/x.ts', "const COLL = 'live_collection';\n");

    const result = runOwnershipCheck({ repoRoot: root });

    expect(result.exitCode).toBe(1);
    const orphan = result.violations.find(
      (v) => v.type === 'ORPHAN_INDEX' && v.collection === 'compositeFeeds'
    );
    expect(orphan).toBeDefined();
  });
});
