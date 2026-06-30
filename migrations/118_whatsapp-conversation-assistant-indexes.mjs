/**
 * Migration 118: WhatsApp Conversation Assistant indexes.
 */

export const metadata = {
  id: '118',
  name: 'whatsapp-conversation-assistant-indexes',
  description: 'Indexes for WhatsApp Conversation Assistant session and turn reads',
  createdAt: '2026-06-30',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_conversation_assistant_sessions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_conversation_assistant_turns',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sessionId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying WhatsApp Conversation Assistant indexes...');
  await context.deployIndexes();
}
