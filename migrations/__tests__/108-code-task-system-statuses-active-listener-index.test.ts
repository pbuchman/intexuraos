import { describe, expect, it, vi } from 'vitest';

import {
  indexes,
  metadata,
  rules,
  up,
} from '../108_code-task-system-statuses-active-listener-index.mjs'; // @allow-missing-js -- .mjs import

describe('migration 108 - code task system statuses active listener index', () => {
  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '108',
      name: 'code-task-system-statuses-active-listener-index',
      description:
        'Composite index and backend-owned rules for code_task_system_statuses active listener queries',
      createdAt: '2026-06-06',
    });
  });

  it('defines the userId + status index required by the dispatch queue listener', () => {
    expect(indexes).toEqual([
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
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await up({ deployIndexes, deployRules });

    expect(deployIndexes).toHaveBeenCalledOnce();
    expect(deployRules).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
  });
});
