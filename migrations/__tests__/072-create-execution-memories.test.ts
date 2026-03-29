import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, rules, up } from '../072_create_execution_memories.mjs';

describe('072-create-execution-memories migration', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '072',
      name: 'create-execution-memories',
      description: 'Create execution memory collections and vector index',
      createdAt: '2026-03-25',
    });
  });

  it('defines a vector index for execution_memories', () => {
    expect(indexes).toHaveLength(2);

    const vectorIndex = indexes.find(
      (index) =>
        index.collectionGroup === 'execution_memories' &&
        index.fields.some((field) => field.fieldPath === 'embedding' && 'vectorConfig' in field)
    );

    expect(vectorIndex).toBeDefined();
    expect(vectorIndex).toMatchObject({
      collectionGroup: 'execution_memories',
      queryScope: 'COLLECTION',
    });
    const embeddingField = vectorIndex?.fields.find((field) => field.fieldPath === 'embedding');
    expect(embeddingField).toMatchObject({
      fieldPath: 'embedding',
      order: 'ASCENDING',
      vectorConfig: {
        dimension: 1536,
        flatIndexEnabled: true,
      },
    });
  });

  it('defines a composite vector-search prefilter index on repository, status, and embedding', () => {
    const compositeIndex = indexes.find(
      (index) =>
        index.collectionGroup === 'execution_memories' &&
        index.fields.length === 3 &&
        index.fields[0]?.fieldPath === 'repository' &&
        index.fields[1]?.fieldPath === 'status' &&
        index.fields[2]?.fieldPath === 'embedding'
    );

    expect(compositeIndex).toBeDefined();
    expect(compositeIndex?.fields).toMatchObject([
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
    ]);
  });

  it('adds backend-only rules for execution memory collections', () => {
    expect(rules.collections['execution_memories/{memoryId}']).toMatchObject({
      read: 'false',
      write: 'false',
    });
    expect(rules.collections['execution_memory_applications/{applicationId}']).toMatchObject({
      read: 'false',
      write: 'false',
    });
  });

  it('deploys indexes and rules in up()', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const deployRules = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await up({ deployIndexes, deployRules });

    expect(deployIndexes).toHaveBeenCalledTimes(1);
    expect(deployRules).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});
