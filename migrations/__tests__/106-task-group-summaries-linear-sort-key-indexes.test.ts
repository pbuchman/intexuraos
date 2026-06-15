import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../106_task-group-summaries-linear-sort-key-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 106 - task-group-summaries linear sort-key indexes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '106',
      name: 'task-group-summaries-linear-sort-key-indexes',
      description:
        'Composite indexes for task_group_summaries supporting numeric linear-id sort with latest-task tie-breaker',
      createdAt: '2026-05-06',
    });
  });

  it('defines filtered and unfiltered linear sort-key indexes', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'task_group_summaries',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
          { fieldPath: 'linearIssueSortKey', order: 'DESCENDING' },
          { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'task_group_summaries',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'linearIssueSortKey', order: 'DESCENDING' },
          { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
        ],
      },
    ]);
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
