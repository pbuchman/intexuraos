import { describe, expect, it, vi } from 'vitest';

import {
  indexes,
  metadata,
  up,
} from '../107_mobile-notifications-timestamp-range-pagination-index.mjs'; // @allow-missing-js -- .mjs import

describe('migration 107 - mobile notifications timestamp range pagination index', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '107',
      name: 'mobile-notifications-timestamp-range-pagination-index',
      description: 'Composite index for mobile notification timestamp-range pagination',
      createdAt: '2026-05-12',
    });
  });

  it('defines the app + userId + timestamp desc + document-name desc index', () => {
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
