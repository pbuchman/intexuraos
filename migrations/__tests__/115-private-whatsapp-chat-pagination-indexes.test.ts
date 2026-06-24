import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../115_private-whatsapp-chat-pagination-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 115 - private whatsapp chat pagination indexes', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '115',
      name: 'private-whatsapp-chat-pagination-indexes',
      description:
        'Stable pagination indexes for private WhatsApp chat lists and chat message reads',
      createdAt: '2026-06-24',
    });
  });

  it('defines the stable chat and chat-message pagination indexes', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_private_chats',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'lastEventAt', order: 'DESCENDING' },
          { fieldPath: '__name__', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'chatId', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'DESCENDING' },
          { fieldPath: '__name__', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'chatId', order: 'ASCENDING' },
          { fieldPath: 'eventDayKey', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'DESCENDING' },
          { fieldPath: '__name__', order: 'DESCENDING' },
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
