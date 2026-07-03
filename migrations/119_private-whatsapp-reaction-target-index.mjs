/**
 * Migration 119: Private WhatsApp reaction target index.
 *
 * Required by whatsapp-service private message reads to load reactions by target message id.
 */

export const metadata = {
  id: '119',
  name: 'private-whatsapp-reaction-target-index',
  description: 'Private WhatsApp reaction lookup by target message id',
  createdAt: '2026-07-03',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'rawMatrixEvent.content.`m.relates_to`.event_id', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'rawMatrixEvent.content.`m.relates_to`.event_id', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying private WhatsApp reaction target indexes...');
  await context.deployIndexes();
}
