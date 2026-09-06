import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../117_private-whatsapp-conversation-context-index.mjs'; // @allow-missing-js -- .mjs import

describe('migration 117 - private whatsapp conversation context index', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '117',
      name: 'private-whatsapp-conversation-context-index',
      description: 'Ascending private WhatsApp message reads for conversation context export',
      createdAt: '2026-06-30',
    });
  });

  it('defines the private conversation context message index', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'chatId', order: 'ASCENDING' },
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
