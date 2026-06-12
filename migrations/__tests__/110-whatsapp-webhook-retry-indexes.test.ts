import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../110_whatsapp-webhook-retry-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 110 - whatsapp webhook retry indexes', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '110',
      name: 'whatsapp-webhook-retry-indexes',
      description: 'Composite indexes for retrying pending and retryable WhatsApp webhook events safely',
      createdAt: '2026-06-10',
    });
  });

  it('defines indexes for webhook draining and message replay idempotency', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_webhook_events',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'receivedAt', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_webhook_events',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'retryable', order: 'ASCENDING' },
          { fieldPath: 'receivedAt', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'waMessageId', order: 'ASCENDING' },
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
