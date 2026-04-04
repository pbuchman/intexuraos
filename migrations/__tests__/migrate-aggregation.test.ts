import { describe, expect, it } from 'vitest';

import { aggregateIndexes, normalizeVectorFields } from '../../scripts/migrate.mjs'; // @allow-missing-js -- .mjs import

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
