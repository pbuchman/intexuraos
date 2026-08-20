import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  collections,
  fieldOverrides,
  indexes,
  metadata,
  up,
} from '../131_code-review-user-slot-index.mjs';

describe('131-code-review-user-slot-index migration', () => {
  it('declares the user-scoped queued review index', () => {
    expect(metadata).toMatchObject({
      id: '131',
      name: 'code-review-user-slot-index',
      createdAt: '2026-08-20',
    });
    expect(collections).toEqual(['code_tasks', 'code_review_events']);
    expect(indexes).toEqual([
      {
        collectionGroup: 'code_tasks',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'repository', order: 'ASCENDING' },
          { fieldPath: 'prNumber', order: 'ASCENDING' },
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'agentType', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' },
        ],
      },
    ]);
    expect(fieldOverrides).toEqual([
      {
        collectionGroup: 'code_review_events',
        fieldPath: 'expireAt',
        ttl: true,
        indexes: [],
      },
    ]);
  });

  it('deploys the generated indexes', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledTimes(1);
  });

  it('is frozen in the immutable migration manifest', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
    ) as {
      lastReservedId: string;
      entries: { id: string; name: string; checksum: string }[];
    };

    expect(manifest.lastReservedId).toBe('131');
    expect(manifest.entries).toContainEqual({
      id: '131',
      name: 'code-review-user-slot-index',
      checksum: 'sha256:0371f01bde11caf284b17ff58786bf9c334517d246617fc8d2acaf8930585bc6',
    });
  });
});
