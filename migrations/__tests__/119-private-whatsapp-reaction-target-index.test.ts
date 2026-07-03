import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../119_private-whatsapp-reaction-target-index.mjs'; // @allow-missing-js -- .mjs import

describe('migration 119 - private WhatsApp reaction target index', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '119',
      name: 'private-whatsapp-reaction-target-index',
      description: 'Private WhatsApp reaction lookup by target message id',
      createdAt: '2026-07-03',
    });
  });

  it('defines normalized private WhatsApp reaction lookup indexes', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'chatId', order: 'ASCENDING' },
          { fieldPath: 'messageType', order: 'ASCENDING' },
          { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
          { fieldPath: '__name__', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'messageType', order: 'ASCENDING' },
          { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
          { fieldPath: '__name__', order: 'ASCENDING' },
        ],
      },
    ]);
  });

  it('deploys indexes in up()', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});
