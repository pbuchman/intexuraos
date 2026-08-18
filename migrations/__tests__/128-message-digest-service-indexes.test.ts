import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collections,
  fieldOverrides,
  indexes,
  metadata,
  up,
} from '../128_message-digest-service-indexes.mjs'; // @allow-missing-js -- .mjs import

type Direction = 'ASCENDING' | 'DESCENDING';

interface IndexField {
  fieldPath: string;
  order: Direction;
}

interface CompositeIndex {
  collectionGroup: string;
  queryScope: 'COLLECTION';
  fields: IndexField[];
}

const ascending = (fieldPath: string): IndexField => ({ fieldPath, order: 'ASCENDING' });
const ordered = (fieldPath: string, order: Direction): IndexField => ({ fieldPath, order });

const definitionFilters: IndexField[][] = [
  [],
  [ascending('listStatus')],
  [ascending('source.chatType')],
  [ascending('listStatus'), ascending('source.chatType')],
];

const definitionIndexes = ['updatedAt', 'nameSortKey', 'nextRunAt'].flatMap((sortField) =>
  (['ASCENDING', 'DESCENDING'] as const).flatMap((direction) =>
    definitionFilters.map(
      (filters): CompositeIndex => ({
        collectionGroup: 'message_digest_definitions',
        queryScope: 'COLLECTION',
        fields: [
          ascending('userId'),
          ascending('status'),
          ...filters,
          ordered(sortField, direction),
          ordered('__name__', direction),
        ],
      })
    )
  )
);

const runFilters: IndexField[][] = [
  [],
  [ascending('generationStatus')],
  [ascending('delivery.status')],
  [ascending('generationStatus'), ascending('delivery.status')],
];

const runHistoryIndexes = (['ASCENDING', 'DESCENDING'] as const).flatMap((direction) =>
  runFilters.map(
    (filters): CompositeIndex => ({
      collectionGroup: 'message_digest_runs',
      queryScope: 'COLLECTION',
      fields: [
        ascending('userId'),
        ascending('definitionId'),
        ascending('recordRole'),
        ascending('visibilityMigrationId'),
        ...filters,
        ordered('windowStart', direction),
        ordered('__name__', direction),
      ],
    })
  )
);

const expectedIndexes: CompositeIndex[] = [
  ...definitionIndexes,
  {
    collectionGroup: 'message_digest_definitions',
    queryScope: 'COLLECTION',
    fields: [ascending('status'), ascending('nextRunAt'), ascending('__name__')],
  },
  ...runHistoryIndexes,
  {
    collectionGroup: 'message_digest_dispatch_outbox',
    queryScope: 'COLLECTION',
    fields: [ascending('status'), ascending('nextAttemptAt'), ascending('__name__')],
  },
  {
    collectionGroup: 'message_digest_runs',
    queryScope: 'COLLECTION',
    fields: [
      ascending('recordRole'),
      ascending('visibilityMigrationId'),
      ascending('generationStatus'),
      ascending('delivery.status'),
      ascending('delivery.nextCheckAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'message_digest_runs',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('definitionId'),
      ascending('lease.expiresAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'message_digest_dispatch_outbox',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('definitionId'),
      ascending('claim.expiresAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'message_digest_runs',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('definitionId'),
      ascending('deliveryAuthorization.expiresAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'message_digest_migration_activations',
    queryScope: 'COLLECTION',
    fields: [ascending('status'), ascending('createdAt'), ascending('__name__')],
  },
  {
    collectionGroup: 'message_digest_definitions',
    queryScope: 'COLLECTION',
    fields: [ascending('userId'), ascending('legacyAlias.groupKey'), ascending('status')],
  },
  {
    collectionGroup: 'message_digest_runs',
    queryScope: 'COLLECTION',
    fields: [
      ascending('userId'),
      ascending('definitionId'),
      ascending('recordRole'),
      ascending('visibilityMigrationId'),
      ascending('trigger'),
      ascending('generationStatus'),
      ordered('scheduledBoundary', 'DESCENDING'),
      ordered('__name__', 'DESCENDING'),
    ],
  },
];

const expectedFieldOverrides = [
  {
    collectionGroup: 'message_digest_erasure_requests',
    fieldPath: 'expiresAt',
    ttl: true,
    indexes: [],
  },
] as const;

describe('migration 128 - Message Digest service indexes', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('declares every exact query family with stable document-ID ordering and one terminal TTL', () => {
    expect(metadata).toEqual({
      id: '128',
      name: 'message-digest-service-indexes',
      description: 'Indexes and terminal-erasure TTL for the Message Digest service',
      createdAt: '2026-07-28',
    });
    expect(collections).toEqual([
      'message_digest_definitions',
      'message_digest_runs',
      'message_digest_states',
      'message_digest_dispatch_outbox',
      'message_digest_erasure_requests',
      'message_digest_migration_activations',
    ]);
    expect(indexes).toEqual(expectedIndexes);
    expect(indexes).toHaveLength(41);
    expect(fieldOverrides).toEqual(expectedFieldOverrides);
  });

  it('tracks every index, the TTL override, and the exact immutable migration checksum', () => {
    const artifact = JSON.parse(
      readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')
    ) as { indexes: unknown[]; fieldOverrides: unknown[] };
    for (const expected of expectedIndexes) {
      expect(
        artifact.indexes.filter((index) => JSON.stringify(index) === JSON.stringify(expected))
      ).toHaveLength(1);
    }
    expect(artifact.fieldOverrides).toEqual(expectedFieldOverrides);

    const manifest = JSON.parse(
      readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
    ) as {
      lastReservedId: string;
      entries: { id: string; name: string; checksum: string }[];
    };
    const source = readFileSync(
      new URL('../128_message-digest-service-indexes.mjs', import.meta.url)
    );
    expect(manifest.lastReservedId).toBe('130');
    expect(manifest.entries.filter((entry) => entry.id === '128')).toEqual([
      {
        id: '128',
        name: 'message-digest-service-indexes',
        checksum: `sha256:${createHash('sha256').update(source).digest('hex')}`,
      },
    ]);
  });

  it('deploys the aggregate index artifact and propagates failures', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    await up({ deployIndexes });
    expect(deployIndexes).toHaveBeenCalledOnce();

    const failure = vi.fn().mockRejectedValue(new Error('deploy failed'));
    await expect(up({ deployIndexes: failure })).rejects.toThrow('deploy failed');
  });
});
