/**
 * Migration 115: Private WhatsApp chat pagination indexes.
 *
 * Required by:
 * - whatsapp-service public private chat list queries
 * - whatsapp-service public private chat message reads
 */

export const metadata = {
  id: '115',
  name: 'private-whatsapp-chat-pagination-indexes',
  description: 'Stable pagination indexes for private WhatsApp chat lists and chat message reads',
  createdAt: '2026-06-24',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_private_chats',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'lastEventAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'eventDayKey', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying private WhatsApp chat pagination indexes...');
  await context.deployIndexes();
}
