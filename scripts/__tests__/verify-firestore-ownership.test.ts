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

function setupTempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'verify-firestore-'));
  mkdirSync(join(root, 'apps'), { recursive: true });
  mkdirSync(join(root, 'workers'), { recursive: true });
  return root;
}

function writeRegistry(root, collections) {
  writeFileSync(join(root, 'firestore-collections.json'), JSON.stringify({ collections }, null, 2));
}

function writeIndexes(root, payload) {
  writeFileSync(join(root, 'firestore.indexes.json'), JSON.stringify(payload, null, 2));
}

function writeFile(root, relPath, contents) {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}

describe('runOwnershipCheck', () => {
  let tempRoots = [];

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

  function setup() {
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
