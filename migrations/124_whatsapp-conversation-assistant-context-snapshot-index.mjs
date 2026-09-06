/**
 * Migration 124: Versioned Conversation Assistant context snapshot index.
 */

export const metadata = {
  id: '124',
  name: 'whatsapp-conversation-assistant-context-snapshot-index',
  description: 'Index for loading versioned Conversation Assistant context snapshot chunks',
  createdAt: '2026-07-20',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_conversation_assistant_context_chunks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sessionId', order: 'ASCENDING' },
      { fieldPath: 'snapshotId', order: 'ASCENDING' },
      { fieldPath: 'kind', order: 'ASCENDING' },
      { fieldPath: 'end', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying the Conversation Assistant context snapshot index...');
  await context.deployIndexes();
}
