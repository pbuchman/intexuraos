import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../104_fishing-assistant-chat-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 104 - fishing assistant chat indexes', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '104',
      name: 'fishing-assistant-chat-indexes',
      description: 'Composite indexes for Fishing Assistant chat session and message queries',
      createdAt: '2026-05-05',
    });
  });

  it('defines indexes for the deployed chat query shapes', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'fishing_chats',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'fishing_chat_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'chatId', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'ASCENDING' },
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
