import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../113_private-whatsapp-day-message-pagination-index.mjs'; // @allow-missing-js -- .mjs import

describe('migration 113 - private whatsapp day message pagination index', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '113',
      name: 'private-whatsapp-day-message-pagination-index',
      description: 'Stable pagination index for private WhatsApp day-filtered message reads',
      createdAt: '2026-06-23',
    });
  });

  it('defines the day-filtered message pagination index', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'senderKey', order: 'ASCENDING' },
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
