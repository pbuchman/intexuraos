import { describe, expect, it, vi } from 'vitest';

import {
  indexes,
  metadata,
  rules,
  up,
} from '../107_mobile-notifications-timestamp-range-pagination-index.mjs'; // @allow-missing-js -- .mjs import

describe('migration 107 - mobile notifications timestamp range pagination index', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '107',
      name: 'mobile-notifications-timestamp-range-pagination-index',
      description:
        'Composite index for mobile notification timestamp-range pagination and code-task system status rules',
      createdAt: '2026-05-12',
    });
  });

  it('defines indexes for notification pagination and code task system status listeners', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'mobile_notifications',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'app', order: 'ASCENDING' },
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'timestamp', order: 'DESCENDING' },
          { fieldPath: '__name__', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'code_task_system_statuses',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' },
        ],
      },
    ]);
  });

  it('defines backend-owned code task system status rules', () => {
    expect(rules.collections['code_task_system_statuses/{statusId}']).toMatchObject({
      get: 'isOwner(resource.data.userId)',
      list: 'isAuthenticated()\n                  && request.query.limit <= 50\n                  && resource.data.userId == request.auth.uid',
      write: 'false',
    });
  });

  it('deploys indexes and rules in up()', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const deployRules = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await up({ deployIndexes, deployRules });

    expect(deployIndexes).toHaveBeenCalledOnce();
    expect(deployRules).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
  });
});
