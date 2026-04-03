import { describe, expect, it } from 'vitest';

import { aggregateIndexes } from '../../scripts/migrate.mjs'; // @allow-missing-js -- .mjs import

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
          vectorConfig: { dimension: 1536, flatIndexEnabled: true },
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
          vectorConfig: { dimension: 1536, flatIndexEnabled: true },
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
});
