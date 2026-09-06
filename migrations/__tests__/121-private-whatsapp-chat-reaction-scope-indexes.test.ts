import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../121_private-whatsapp-chat-reaction-scope-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 121 - private WhatsApp chat reaction scope indexes', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '121',
      name: 'private-whatsapp-chat-reaction-scope-indexes',
      description: 'Chat-first indexes for private WhatsApp inline reaction hydration',
      createdAt: '2026-07-05',
    });
  });

  it('defines chat-scoped reaction indexes in Firestore requested field order', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'chatId', order: 'ASCENDING' },
          { fieldPath: 'messageType', order: 'ASCENDING' },
          { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
          { fieldPath: '__name__', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'chatId', order: 'ASCENDING' },
          { fieldPath: 'messageType', order: 'ASCENDING' },
          { fieldPath: 'rawMatrixEvent.content.`m.relates_to`.event_id', order: 'ASCENDING' },
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
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
