/**
 * Migration 121: Private WhatsApp chat-scoped reaction indexes.
 *
 * Required by whatsapp-service private chat message reads to hydrate inline reactions
 * when Firestore chooses chat-first equality field ordering.
 */

export const metadata = {
  id: '121',
  name: 'private-whatsapp-chat-reaction-scope-indexes',
  description: 'Chat-first indexes for private WhatsApp inline reaction hydration',
  createdAt: '2026-07-05',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'rawMatrixEvent.content.`m.relates_to`.event_id', order: 'ASCENDING' },
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying private WhatsApp chat-scoped reaction indexes');
  await context.deployIndexes();
}
