import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../118_whatsapp-conversation-assistant-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 118 - whatsapp conversation assistant indexes', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '118',
      name: 'whatsapp-conversation-assistant-indexes',
      description: 'Indexes for WhatsApp Conversation Assistant session and turn reads',
      createdAt: '2026-06-30',
    });
  });

  it('defines session and turn indexes', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_conversation_assistant_sessions',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'updatedAt', order: 'DESCENDING' },
          { fieldPath: '__name__', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_conversation_assistant_turns',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sessionId', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'ASCENDING' },
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
