import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../101_fishing-assistant-knowledge-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 101 - fishing assistant knowledge indexes', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '101',
      name: 'fishing-assistant-knowledge-indexes',
      description: 'Composite and vector indexes for Fishing Assistant knowledge base queries',
      createdAt: '2026-05-05',
    });
  });

  it('defines indexes for every deployed knowledge repository query shape', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'fishing_knowledge_folders',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'sortOrder', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_pages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'updatedAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_pages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'folderId', order: 'ASCENDING' },
          { fieldPath: 'updatedAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_pages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'folderId', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_chunks',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'pageId', order: 'ASCENDING' },
          { fieldPath: 'index', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_chunks',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'pageId', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_knowledge_chunks',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
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
    ]);
  });

  it('deploys indexes in up()', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
  });
});
