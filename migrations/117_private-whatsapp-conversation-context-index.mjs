/**
 * Migration 117: Private WhatsApp conversation context index.
 *
 * Required by whatsapp-service internal direct-chat conversation context export.
 */

export const metadata = {
  id: '117',
  name: 'private-whatsapp-conversation-context-index',
  description: 'Ascending private WhatsApp message reads for conversation context export',
  createdAt: '2026-06-30',
};

export const indexes = [
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
];

export async function up(context) {
  console.log('  Deploying private WhatsApp conversation context index...');
  await context.deployIndexes();
}
