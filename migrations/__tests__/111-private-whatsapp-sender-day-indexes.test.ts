import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../111_private-whatsapp-sender-day-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 111 - private whatsapp sender day indexes', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '111',
      name: 'private-whatsapp-sender-day-indexes',
      description: 'Composite indexes for private WhatsApp sender and sender-day queries',
      createdAt: '2026-06-23',
    });
  });

  it('defines indexes for private WhatsApp message ranges and sender-day rollups', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'DESCENDING' },
          { fieldPath: '__name__', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'senderKey', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'DESCENDING' },
          { fieldPath: '__name__', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'eventDayKey', order: 'ASCENDING' },
          { fieldPath: 'senderKey', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_senders',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'lastEventAt', order: 'DESCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_sender_days',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'eventDayKey', order: 'DESCENDING' },
          { fieldPath: 'senderKey', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_sender_days',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'senderKey', order: 'ASCENDING' },
          { fieldPath: 'eventDayKey', order: 'DESCENDING' },
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
