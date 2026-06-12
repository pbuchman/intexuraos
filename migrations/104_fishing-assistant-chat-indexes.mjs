/**
 * Migration 104: Fishing Assistant chat indexes
 *
 * Adds the composite indexes required by the Fishing Assistant persisted
 * chat session and chat-message query surfaces.
 */

export const metadata = {
  id: '104',
  name: 'fishing-assistant-chat-indexes',
  description: 'Composite indexes for Fishing Assistant chat session and message queries',
  createdAt: '2026-05-05',
};

export const indexes = [
  {
    collectionGroup: 'fishing_chats',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'fishing_chat_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Fishing Assistant chat indexes...');
  await context.deployIndexes();
}
