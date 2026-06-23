/**
 * Migration 112: Private WhatsApp sender pagination index.
 *
 * Required by:
 * - whatsapp-service public private sender list queries
 */

export const metadata = {
  id: '112',
  name: 'private-whatsapp-sender-pagination-index',
  description: 'Stable pagination index for private WhatsApp sender lists',
  createdAt: '2026-06-23',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_private_senders',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'lastEventAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying private WhatsApp sender pagination indexes...');
  await context.deployIndexes();
}
