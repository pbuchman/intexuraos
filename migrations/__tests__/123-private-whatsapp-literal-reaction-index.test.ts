import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../123_private-whatsapp-literal-reaction-index.mjs'; // @allow-missing-js -- .mjs import

describe('migration 123 - private WhatsApp literal reaction index', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toEqual({
      id: '123',
      name: 'private-whatsapp-literal-reaction-index',
      description: 'Composite index required by private WhatsApp legacy reaction reads',
      createdAt: '2026-07-19',
    });
  });

  it('defines the exact composite index requested by Firestore', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'chatId', order: 'ASCENDING' },
          { fieldPath: 'messageType', order: 'ASCENDING' },
          {
            fieldPath: 'rawMatrixEvent.content.`\\`m`.`relates_to\\``.event_id',
            order: 'ASCENDING',
          },
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

  it('propagates deployIndexes failures from up()', async () => {
    const deployIndexes = vi.fn().mockRejectedValue(new Error('deploy failed'));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(up({ deployIndexes })).rejects.toThrow('deploy failed');

    expect(deployIndexes).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});
