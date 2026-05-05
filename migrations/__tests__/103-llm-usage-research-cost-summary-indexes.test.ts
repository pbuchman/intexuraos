import { describe, it, expect, vi } from 'vitest';
import { indexes, metadata, up } from '../103_llm-usage-research-cost-summary-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 103 – llm usage research cost summary indexes', () => {
  it('declares immutable metadata', () => {
    expect(metadata).toEqual({
      id: '103',
      name: 'llm-usage-research-cost-summary-indexes',
      description: 'Composite indexes for llm_usage_events research-cost summary queries',
      createdAt: '2026-05-05',
    });
  });

  it('adds indexes for researchId summary queries with and without owner guard', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'llm_usage_events',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'correlation.researchId', order: 'ASCENDING' },
          { fieldPath: 'occurredAt', order: 'ASCENDING' },
          { fieldPath: '__name__', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'llm_usage_events',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'correlation.researchId', order: 'ASCENDING' },
          { fieldPath: 'owner.type', order: 'ASCENDING' },
          { fieldPath: 'owner.id', order: 'ASCENDING' },
          { fieldPath: 'occurredAt', order: 'ASCENDING' },
          { fieldPath: '__name__', order: 'ASCENDING' },
        ],
      },
    ]);
  });

  it('deploys indexes in up()', async () => {
    const context = { deployIndexes: vi.fn().mockResolvedValue(undefined) };
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await up(context);

    expect(context.deployIndexes).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
