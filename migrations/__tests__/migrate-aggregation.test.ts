import { describe, expect, it } from 'vitest';

import { aggregateIndexes, aggregateRules, normalizeVectorFields } from '../../scripts/migrate.mjs'; // @allow-missing-js -- .mjs import

describe('aggregateIndexes', () => {
  it('skips regular single-field indexes (auto-created by Firestore)', () => {
    const migrations = [
      {
        indexes: [
          {
            collectionGroup: 'foo',
            queryScope: 'COLLECTION',
            fields: [{ fieldPath: 'bar', order: 'ASCENDING' }],
          },
        ],
      },
    ];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(0);
  });

  it('skips indexes where __name__ is the only companion field (effectively single-field)', () => {
    const migrations = [
      {
        indexes: [
          {
            collectionGroup: 'llm_usage_events',
            queryScope: 'COLLECTION',
            fields: [
              { fieldPath: 'occurredAt', order: 'ASCENDING' },
              { fieldPath: '__name__', order: 'ASCENDING' },
            ],
          },
        ],
      },
    ];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(0);
  });

  it('keeps composite indexes that include __name__ alongside 2+ real fields', () => {
    const migrations = [
      {
        indexes: [
          {
            collectionGroup: 'events',
            queryScope: 'COLLECTION',
            fields: [
              { fieldPath: 'status', order: 'ASCENDING' },
              { fieldPath: 'occurredAt', order: 'DESCENDING' },
              { fieldPath: '__name__', order: 'DESCENDING' },
            ],
          },
        ],
      },
    ];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(1);
  });

  it('preserves single-field vector indexes (Firestore does NOT auto-create these)', () => {
    const migrations = [
      {
        indexes: [
          {
            collectionGroup: 'execution_memories',
            queryScope: 'COLLECTION',
            fields: [
              {
                fieldPath: 'embedding',
                order: 'ASCENDING',
                vectorConfig: {
                  dimension: 1536,
                  flatIndexEnabled: true,
                },
              },
            ],
          },
        ],
      },
    ];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(1);
    expect(result.indexes[0]).toMatchObject({
      collectionGroup: 'execution_memories',
      fields: [
        {
          fieldPath: 'embedding',
          vectorConfig: { dimension: 1536, flat: {} },
        },
      ],
    });
  });

  it('preserves composite indexes (2+ fields, no vector)', () => {
    const migrations = [
      {
        indexes: [
          {
            collectionGroup: 'tasks',
            queryScope: 'COLLECTION',
            fields: [
              { fieldPath: 'status', order: 'ASCENDING' },
              { fieldPath: 'createdAt', order: 'DESCENDING' },
            ],
          },
        ],
      },
    ];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(1);
    expect(result.indexes[0]).toMatchObject({
      collectionGroup: 'tasks',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    });
  });

  it('preserves composite vector indexes (e.g., repository + status + embedding)', () => {
    const migrations = [
      {
        indexes: [
          {
            collectionGroup: 'execution_memories',
            queryScope: 'COLLECTION',
            fields: [
              { fieldPath: 'repository', order: 'ASCENDING' },
              { fieldPath: 'status', order: 'ASCENDING' },
              {
                fieldPath: 'embedding',
                order: 'ASCENDING',
                vectorConfig: {
                  dimension: 1536,
                  flatIndexEnabled: true,
                },
              },
            ],
          },
        ],
      },
    ];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(1);
    expect(result.indexes[0]).toMatchObject({
      collectionGroup: 'execution_memories',
      fields: [
        { fieldPath: 'repository', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        {
          fieldPath: 'embedding',
          vectorConfig: { dimension: 1536, flat: {} },
        },
      ],
    });
  });

  it('deduplicates identical indexes across migrations', () => {
    const sharedIndex = {
      collectionGroup: 'tasks',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    };

    const migrations = [{ indexes: [sharedIndex] }, { indexes: [sharedIndex] }];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(1);
  });

  it('handles migrations with empty indexes arrays', () => {
    const migrations = [{ indexes: [] }, { indexes: [] }];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(0);
    expect(result.fieldOverrides).toHaveLength(0);
  });

  it('handles migrations with undefined indexes', () => {
    const migrations = [{}, { indexes: undefined }];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(0);
    expect(result.fieldOverrides).toHaveLength(0);
  });

  it('normalizes vector fields by stripping order and converting flatIndexEnabled to flat', () => {
    const migrations = [
      {
        indexes: [
          {
            collectionGroup: 'execution_memories',
            queryScope: 'COLLECTION',
            fields: [
              { fieldPath: 'repository', order: 'ASCENDING' },
              { fieldPath: 'status', order: 'ASCENDING' },
              {
                fieldPath: 'embedding',
                order: 'ASCENDING',
                vectorConfig: {
                  dimension: 1536,
                  flatIndexEnabled: true,
                },
              },
            ],
          },
        ],
      },
    ];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(1);
    const embeddingField = result.indexes[0]?.fields.find(
      (f: Record<string, unknown>) => f.fieldPath === 'embedding'
    );
    expect(embeddingField).toEqual({
      fieldPath: 'embedding',
      vectorConfig: { dimension: 1536, flat: {} },
    });
    expect(embeddingField).not.toHaveProperty('order');
  });

  it('deduplicates vector indexes after normalization', () => {
    const indexWithOldFormat = {
      collectionGroup: 'memories',
      queryScope: 'COLLECTION',
      fields: [
        {
          fieldPath: 'embedding',
          order: 'ASCENDING',
          vectorConfig: { dimension: 1536, flatIndexEnabled: true },
        },
      ],
    };
    const indexWithCorrectFormat = {
      collectionGroup: 'memories',
      queryScope: 'COLLECTION',
      fields: [
        {
          fieldPath: 'embedding',
          vectorConfig: { dimension: 1536, flat: {} },
        },
      ],
    };

    const migrations = [{ indexes: [indexWithOldFormat] }, { indexes: [indexWithCorrectFormat] }];

    const result = aggregateIndexes(migrations);

    expect(result.indexes).toHaveLength(1);
  });

  it('aggregates fieldOverrides and deduplicates them', () => {
    const override = {
      collectionGroup: 'tasks',
      fieldPath: 'status',
      indexes: [{ queryScope: 'COLLECTION', order: 'ASCENDING' }],
    };

    const migrations = [{ fieldOverrides: [override] }, { fieldOverrides: [override] }];

    const result = aggregateIndexes(migrations);

    expect(result.fieldOverrides).toHaveLength(1);
    expect(result.fieldOverrides[0]).toMatchObject(override);
  });

  it('drops indexes whose collectionGroup is in removedCollectionGroups (cleanup migration after source)', () => {
    const sourceMigration = {
      indexes: [
        {
          collectionGroup: 'compositeFeeds',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'updatedAt', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'tasks',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'createdAt', order: 'DESCENDING' },
          ],
        },
      ],
    };
    const cleanupMigration = {
      indexes: [],
      removedCollectionGroups: ['compositeFeeds'],
    };

    const result = aggregateIndexes([sourceMigration, cleanupMigration]);

    expect(result.indexes).toHaveLength(1);
    expect(result.indexes[0]?.collectionGroup).toBe('tasks');
  });

  it('drops fieldOverrides whose collectionGroup is in removedCollectionGroups', () => {
    const sourceMigration = {
      fieldOverrides: [
        {
          collectionGroup: 'by_user',
          fieldPath: 'userId',
          indexes: [{ queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' }],
        },
        {
          collectionGroup: 'kept_group',
          fieldPath: 'foo',
          indexes: [{ queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' }],
        },
      ],
    };
    const cleanupMigration = {
      removedCollectionGroups: ['by_user'],
    };

    const result = aggregateIndexes([sourceMigration, cleanupMigration]);

    expect(result.fieldOverrides).toHaveLength(1);
    expect(result.fieldOverrides[0]?.collectionGroup).toBe('kept_group');
  });

  it('drops indexes regardless of cleanup migration ordering (cleanup before source)', () => {
    const cleanupMigration = {
      removedCollectionGroups: ['compositeFeeds'],
    };
    const sourceMigration = {
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
    };

    const result = aggregateIndexes([cleanupMigration, sourceMigration]);

    expect(result.indexes).toHaveLength(0);
  });

  it('unions removedCollectionGroups across multiple cleanup migrations', () => {
    const sourceMigration = {
      indexes: [
        {
          collectionGroup: 'foo',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'a', order: 'ASCENDING' },
            { fieldPath: 'b', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'bar',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'a', order: 'ASCENDING' },
            { fieldPath: 'b', order: 'DESCENDING' },
          ],
        },
      ],
    };
    const cleanupA = { removedCollectionGroups: ['foo'] };
    const cleanupB = { removedCollectionGroups: ['bar'] };

    const result = aggregateIndexes([sourceMigration, cleanupA, cleanupB]);

    expect(result.indexes).toHaveLength(0);
  });
});

describe('normalizeVectorFields', () => {
  it('returns non-vector indexes unchanged', () => {
    const index = {
      collectionGroup: 'tasks',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    };

    expect(normalizeVectorFields(index)).toEqual(index);
  });

  it('strips order and converts flatIndexEnabled to flat on vector fields', () => {
    const index = {
      collectionGroup: 'memories',
      queryScope: 'COLLECTION',
      fields: [
        {
          fieldPath: 'embedding',
          order: 'ASCENDING',
          vectorConfig: { dimension: 1536, flatIndexEnabled: true },
        },
      ],
    };

    const result = normalizeVectorFields(index);

    expect(result.fields[0]).toEqual({
      fieldPath: 'embedding',
      vectorConfig: { dimension: 1536, flat: {} },
    });
  });

  it('leaves non-vector fields in a composite index untouched', () => {
    const index = {
      collectionGroup: 'memories',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'repository', order: 'ASCENDING' },
        {
          fieldPath: 'embedding',
          order: 'ASCENDING',
          vectorConfig: { dimension: 1536, flatIndexEnabled: true },
        },
      ],
    };

    const result = normalizeVectorFields(index);

    expect(result.fields[0]).toEqual({ fieldPath: 'repository', order: 'ASCENDING' });
    expect(result.fields[1]).toEqual({
      fieldPath: 'embedding',
      vectorConfig: { dimension: 1536, flat: {} },
    });
  });

  it('handles already-correct vector field format (no order, flat: {})', () => {
    const index = {
      collectionGroup: 'memories',
      queryScope: 'COLLECTION',
      fields: [
        {
          fieldPath: 'embedding',
          vectorConfig: { dimension: 1536, flat: {} },
        },
      ],
    };

    const result = normalizeVectorFields(index);

    expect(result.fields[0]).toEqual({
      fieldPath: 'embedding',
      vectorConfig: { dimension: 1536, flat: {} },
    });
  });
});

describe('aggregateRules', () => {
  it('drops collection rules whose path is in removedRulePaths', () => {
    const sourceMigration = {
      rules: {
        collections: {
          'doc_embeddings/{chunkId}': {
            read: 'isAuthenticated()',
          },
          'profiles/{profileId}': {
            read: 'isAuthenticated()',
          },
        },
      },
    };
    const cleanupMigration = {
      removedRulePaths: ['doc_embeddings/{chunkId}'],
    };

    const result = aggregateRules([sourceMigration, cleanupMigration]);

    expect(result.collections).not.toHaveProperty('doc_embeddings/{chunkId}');
    expect(result.collections).toHaveProperty('profiles/{profileId}');
  });
});
