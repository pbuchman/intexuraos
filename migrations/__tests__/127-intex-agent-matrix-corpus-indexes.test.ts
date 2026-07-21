import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collections, indexes, metadata, up } from '../127_intex-agent-matrix-corpus-indexes.mjs'; // @allow-missing-js -- .mjs import

const expectedIndexes = [
  {
    collectionGroup: 'intex_agent_session_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sessionId', order: 'ASCENDING' },
      { fieldPath: 'eventSequence', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'intex_agent_test_runs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'runtimeAudience', order: 'ASCENDING' },
      { fieldPath: 'startedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'intex_agent_test_runs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'artifactDelivery.status', order: 'ASCENDING' },
      { fieldPath: 'finishedAt', order: 'ASCENDING' },
    ],
  },
] as const;

describe('migration 127 - Intex Agent Matrix corpus projection indexes', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('declares exactly the three ordered indexes required by Test Runs', () => {
    expect(metadata).toEqual({
      id: '127',
      name: 'intex-agent-matrix-corpus-indexes',
      description: 'Indexes for Test Runs retention, event watermarks, and artifact recovery',
      createdAt: '2026-07-20',
    });
    expect(collections).toEqual(['intex_agent_session_events', 'intex_agent_test_runs']);
    expect(indexes).toEqual(expectedIndexes);
    for (const expected of expectedIndexes) {
      expect(
        indexes.filter((index) => JSON.stringify(index) === JSON.stringify(expected))
      ).toHaveLength(1);
    }
  });

  it('tracks the exact index artifact and migration checksum', () => {
    const artifact = JSON.parse(
      readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')
    ) as { indexes: unknown[] };
    for (const expected of expectedIndexes) {
      expect(
        artifact.indexes.filter((index) => JSON.stringify(index) === JSON.stringify(expected))
      ).toHaveLength(1);
    }

    const manifest = JSON.parse(
      readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
    ) as { entries: { id: string; name: string; checksum: string }[] };
    const source = readFileSync(
      new URL('../127_intex-agent-matrix-corpus-indexes.mjs', import.meta.url)
    );
    expect(manifest.entries.at(-1)).toEqual({
      id: '127',
      name: 'intex-agent-matrix-corpus-indexes',
      checksum: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    });
  });

  it('deploys the aggregate index artifact and propagates failures', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    await up({ deployIndexes });
    expect(deployIndexes).toHaveBeenCalledOnce();

    const failure = vi.fn().mockRejectedValue(new Error('deploy failed'));
    await expect(up({ deployIndexes: failure })).rejects.toThrow('deploy failed');
  });
});
