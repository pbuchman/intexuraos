/**
 * Migration 110: WhatsApp webhook retry indexes.
 *
 * Required by:
 * - whatsapp-service pending webhook drain: status == pending, receivedAt asc
 * - whatsapp-service retryable failed webhook drain: status == failed, retryable == true, receivedAt asc
 * - whatsapp-service webhook replay idempotency: userId + waMessageId lookup
 */

export const metadata = {
  id: '110',
  name: 'whatsapp-webhook-retry-indexes',
  description: 'Composite indexes for retrying pending and retryable WhatsApp webhook events safely',
  createdAt: '2026-06-10',
};

export const indexes = [
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
];

export async function up(context) {
  console.log('  Deploying WhatsApp webhook retry indexes...');
  await context.deployIndexes();
}
