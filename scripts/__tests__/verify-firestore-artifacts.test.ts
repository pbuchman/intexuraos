import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyFirestoreArtifacts } from '../verify-firestore-artifacts.mjs'; // @allow-missing-js -- .mjs import

function createTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'verify-firestore-artifacts-'));
  mkdirSync(join(root, 'migrations'), { recursive: true });
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
});
