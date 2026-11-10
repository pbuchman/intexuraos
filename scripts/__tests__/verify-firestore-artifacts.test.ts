import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyFirestoreArtifacts } from '../verify-firestore-artifacts.mjs'; // @allow-missing-js -- .mjs import
// @allow-missing-js -- .mjs import
import {
  buildAggregatedFirestoreArtifacts,
  loadFirestoreMigrations,
  loadFirestoreMonitoringIndexes,
  writeAggregatedFirestoreArtifacts,
} from '../lib/firestore-artifacts.mjs';

function createTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'verify-firestore-artifacts-'));
  mkdirSync(join(root, 'migrations'), { recursive: true });
  writeFileSync(
    join(root, 'firestore.monitoring-indexes.json'),
    JSON.stringify({ schemaVersion: 1, indexes: {} })
  );
  return root;
}

function writeMigration(root: string): void {
  writeFileSync(
    join(root, 'migrations', '001_users-indexes.mjs'),
    `export const metadata = {
  id: '001',
  name: 'users-indexes',
  description: 'fixture migration'
};

export const indexes = [
  {
    collectionGroup: 'users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'name', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' }
    ]
  }
];

export const rules = {
  collections: {
    'users/{userId}': {
      get: 'true',
      write: 'false'
    },
    '{document=**}': {
      read: 'false'
    }
  }
};

export async function up() {}
`
  );
}

function writeExpectedArtifacts(root: string): void {
  writeFileSync(
    join(root, 'firestore.indexes.json'),
    JSON.stringify(
      {
        indexes: [
          {
            collectionGroup: 'users',
            queryScope: 'COLLECTION',
            fields: [
              { fieldPath: 'name', order: 'ASCENDING' },
              { fieldPath: 'createdAt', order: 'DESCENDING' },
            ],
          },
        ],
        fieldOverrides: [],
      },
      null,
      2
    ) + '\n'
  );

  writeFileSync(
    join(root, 'firestore.rules'),
    `rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow get: if true;

      allow write: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }

  }
}
`
  );
}

describe('verifyFirestoreArtifacts', () => {
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

  it('passes when committed artifacts match the migration aggregation', async () => {
    const root = setup();
    writeMigration(root);
    writeExpectedArtifacts(root);

    const result = await verifyFirestoreArtifacts({ repoRoot: root });

    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('fails when firestore.rules diverges from the migration aggregation', async () => {
    const root = setup();
    writeMigration(root);
    writeExpectedArtifacts(root);
    writeFileSync(join(root, 'firestore.rules'), "rules_version = '2';\n// drifted\n");

    const result = await verifyFirestoreArtifacts({ repoRoot: root });

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('firestore.rules')])
    );
    expect(result.exitCode).toBe(1);
  });

  it('fails when firestore.indexes.json diverges from the migration aggregation', async () => {
    const root = setup();
    writeMigration(root);
    writeExpectedArtifacts(root);
    writeFileSync(
      join(root, 'firestore.indexes.json'),
      JSON.stringify({ indexes: [], fieldOverrides: [] }, null, 2) + '\n'
    );

    const result = await verifyFirestoreArtifacts({ repoRoot: root });

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('firestore.indexes.json')])
    );
    expect(result.exitCode).toBe(1);
  });

  it('retains the Terraform monitoring catalog through generation and drift verification', async () => {
    const root = setup();
    writeMigration(root);
    const monitoringIndex = {
      collectionGroup: 'message_digest_monitoring_runs',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'outcome', order: 'ASCENDING' },
        { fieldPath: 'scheduledBoundary', order: 'DESCENDING' },
      ],
    };
    writeFileSync(
      join(root, 'firestore.monitoring-indexes.json'),
      JSON.stringify({ schemaVersion: 1, indexes: { delivered_boundary: monitoringIndex } })
    );
    await writeAggregatedFirestoreArtifacts({ repoRoot: root, silent: true });
    const generated = JSON.parse(readFileSync(join(root, 'firestore.indexes.json'), 'utf8')) as {
      indexes: unknown[];
    };
    expect(generated.indexes).toHaveLength(2);
    expect(generated.indexes).toContainEqual(monitoringIndex);
    expect((await verifyFirestoreArtifacts({ repoRoot: root })).exitCode).toBe(0);
    writeExpectedArtifacts(root);
    expect((await verifyFirestoreArtifacts({ repoRoot: root })).exitCode).toBe(1);
  });

  it('merges all four actual monitoring indexes and keeps Terraform resource keys stable', async () => {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const catalog = JSON.parse(
      readFileSync(join(repoRoot, 'firestore.monitoring-indexes.json'), 'utf8')
    ) as { indexes: Record<string, unknown> };
    expect(Object.keys(catalog.indexes)).toEqual([
      'unresolved',
      'delivered_boundary',
      'delivered_at',
      'current_cursor',
    ]);
    const migrations = await loadFirestoreMigrations({ repoRoot });
    const indexes = loadFirestoreMonitoringIndexes({ repoRoot }) as unknown[];
    const legacy = buildAggregatedFirestoreArtifacts(migrations) as {
      indexesData: { indexes: unknown[] };
    };
    const merged = buildAggregatedFirestoreArtifacts(migrations, indexes) as {
      indexesData: { indexes: unknown[] };
    };
    expect(indexes).toHaveLength(4);
    expect(merged.indexesData.indexes).toEqual([...legacy.indexesData.indexes, ...indexes]);
    const terraform = readFileSync(
      join(repoRoot, 'terraform/modules/firestore/monitoring.tf'),
      'utf8'
    );
    expect(terraform).toContain('resource "google_firestore_index" "digest_monitoring"');
    expect(terraform).toContain(
      'jsondecode(file("${path.module}/../../../firestore.monitoring-indexes.json")).indexes'
    );
    expect(terraform).toContain('field_path = fields.value.fieldPath');
    expect(terraform).toContain('for_each = local.digest_monitoring_indexes');
  });

  it('blocks artifact generation when the required monitoring catalog is missing or invalid', async () => {
    const root = setup();
    rmSync(join(root, 'firestore.monitoring-indexes.json'));
    await expect(
      writeAggregatedFirestoreArtifacts({ repoRoot: root, silent: true })
    ).rejects.toThrow();
    for (const catalog of [
      { schemaVersion: 2, indexes: {} },
      { schemaVersion: 1, indexes: {}, unknown: true },
      { schemaVersion: 1, indexes: { invalid: { collectionGroup: 'runs', fields: [] } } },
      {
        schemaVersion: 1,
        indexes: {
          invalid: {
            collectionGroup: 'runs',
            queryScope: 'COLLECTION',
            fields: [
              { fieldPath: 'status', order: 'ASCENDING' },
              { fieldPath: 'status', order: 'ASCENDING' },
            ],
          },
        },
      },
    ]) {
      writeFileSync(join(root, 'firestore.monitoring-indexes.json'), JSON.stringify(catalog));
      await expect(
        writeAggregatedFirestoreArtifacts({ repoRoot: root, silent: true })
      ).rejects.toThrow('Invalid Firestore monitoring index');
    }
  });
});
