/**
 * Migration 119: Pending WhatsApp indexes.
 *
 * Required by whatsapp-service private message reads to load reactions by target message id.
 * Also supports owner-filtered Conversation Assistant turn snapshots.
 */

export const metadata = {
  id: '119',
  name: 'private-whatsapp-reaction-target-index',
  description: 'Private WhatsApp reaction lookup and Conversation Assistant turn snapshots',
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
  {
    collectionGroup: 'whatsapp_conversation_assistant_turns',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sessionId', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying pending WhatsApp indexes...');
  await context.deployIndexes();
}
