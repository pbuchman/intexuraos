import { describe, expect, it, vi } from 'vitest';

import { collections, indexes, metadata, up } from '../074_execution-memory-pipeline-indexes.mjs';

describe('074-execution-memory-pipeline-indexes migration', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '074',
      name: 'execution-memory-pipeline-indexes',
      description: 'Add composite indexes for execution memory backlog processing',
      createdAt: '2026-03-25',
    });
  });

  it('declares the code_tasks collection', () => {
    expect(collections).toEqual(['code_tasks']);
  });

  it('defines the post-run backlog composite index', () => {
    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({
      collectionGroup: 'code_tasks',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'agentType', order: 'ASCENDING' },
        { fieldPath: 'executionMemoryPostRun.status', order: 'ASCENDING' },
        { fieldPath: 'completedAt', order: 'ASCENDING' },
      ],
    });
  });

  it('deploys indexes in up()', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});
