import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  collections,
  indexes,
  metadata,
  up,
} from '../129_github-pr-summaries-reconciliation-index.mjs';

const expectedIndex = {
  collectionGroup: 'github-pr-summaries',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'state', order: 'ASCENDING' },
    { fieldPath: 'lastConflictCheckedAt', order: 'ASCENDING' },
  ],
};

describe('migration 129 - GitHub PR summary reconciliation index', () => {
  it('declares the bounded oldest-open reconciliation index', () => {
    expect(metadata).toMatchObject({
      id: '129',
      name: 'github-pr-summaries-reconciliation-index',
      createdAt: '2026-08-10',
    });
    expect(collections).toEqual(['github-pr-summaries']);
    expect(indexes).toEqual([expectedIndex]);
  });

  it('tracks the exact generated artifact and migration checksum', () => {
    const artifact = JSON.parse(
      readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')
    ) as { indexes: unknown[] };
    expect(
      artifact.indexes.filter((index) => JSON.stringify(index) === JSON.stringify(expectedIndex))
    ).toHaveLength(1);

    const manifest = JSON.parse(
      readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
    ) as {
      lastReservedId: string;
      entries: { id: string; name: string; checksum: string }[];
    };
    const source = readFileSync(
      new URL('../129_github-pr-summaries-reconciliation-index.mjs', import.meta.url)
    );
    expect(manifest.lastReservedId).toBe('130');
    expect(manifest.entries.find((entry) => entry.id === '129')).toEqual({
      id: '129',
      name: 'github-pr-summaries-reconciliation-index',
      checksum: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    });
  });

  it('deploys the aggregate index artifact', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });
});
