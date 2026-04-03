import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../077_task-group-summaries-last-updated-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 077 – task-group-summaries last-updated indexes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '077',
      name: 'task-group-summaries-last-updated-indexes',
      description:
        'Composite indexes for task_group_summaries supporting last-updated sort (latestTaskUpdatedAt) with and without status filter',
      createdAt: '2026-04-03',
    });
  });

  it('defines exactly 2 composite indexes', () => {
    expect(indexes).toHaveLength(2);
  });

  it('defines the filtered index (userId + aggregateStatus + latestTaskUpdatedAt)', () => {
    expect(indexes[0]).toMatchObject({
      collectionGroup: 'task_group_summaries',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'userId', order: 'ASCENDING' },
        { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
        { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
      ],
    });
  });

  it('defines the unfiltered index (userId + latestTaskUpdatedAt)', () => {
    expect(indexes[1]).toMatchObject({
      collectionGroup: 'task_group_summaries',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'userId', order: 'ASCENDING' },
        { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
      ],
    });
  });

  it('deploys indexes in up()', async () => {
    const context = {
      firestore: {},
      projectId: 'test-project',
      deployIndexes: vi.fn().mockResolvedValue(undefined),
      deployRules: vi.fn().mockResolvedValue(undefined),
    };

    await up(context);

    expect(context.deployIndexes).toHaveBeenCalledOnce();
  });
});
