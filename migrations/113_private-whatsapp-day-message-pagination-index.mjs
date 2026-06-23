/**
 * Migration 113: Private WhatsApp day-filtered message pagination index.
 *
 * Required by:
 * - whatsapp-service public private message reads filtered by sender and day
 */

export const metadata = {
  id: '113',
  name: 'private-whatsapp-day-message-pagination-index',
  description: 'Stable pagination index for private WhatsApp day-filtered message reads',
  createdAt: '2026-06-23',
};

export const indexes = [
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
];

export async function up(context) {
  console.log('  Deploying private WhatsApp day-filtered message pagination indexes...');
  await context.deployIndexes();
}
