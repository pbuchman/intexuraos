import { describe, expect, it, vi } from 'vitest';

import {
  indexes,
  metadata,
  up,
} from '../124_whatsapp-conversation-assistant-context-snapshot-index.mjs'; // @allow-missing-js -- .mjs import

describe('migration 124 - whatsapp conversation assistant context snapshot index', () => {
  it('defines the versioned context-chunk lookup index', () => {
    expect(metadata).toMatchObject({
      id: '124',
      name: 'whatsapp-conversation-assistant-context-snapshot-index',
      createdAt: '2026-07-20',
    });
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_conversation_assistant_context_chunks',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sessionId', order: 'ASCENDING' },
          { fieldPath: 'snapshotId', order: 'ASCENDING' },
          { fieldPath: 'kind', order: 'ASCENDING' },
          { fieldPath: 'end', order: 'ASCENDING' },
        ],
      },
    ]);
  });

  it('deploys the aggregated indexes', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});
