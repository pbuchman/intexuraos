/**
 * Migration 125: Exact-cutoff private WhatsApp journal and durable
 * Conversation Assistant context-attachment indexes.
 */

export const metadata = {
  id: '125',
  name: 'whatsapp-conversation-assistant-context-attachments-indexes',
  description:
    'Indexes for private WhatsApp context journals, context attachments, and durable Assistant turns',
  createdAt: '2026-07-21',
};

const ascending = (fieldPath) => ({ fieldPath, order: 'ASCENDING' });
const descending = (fieldPath) => ({ fieldPath, order: 'DESCENDING' });

export const indexes = [
  {
    collectionGroup: 'whatsapp_private_context_changes',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sourceAccountId'),
      ascending('chatId'),
      ascending('sequence'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sourceAccountId'),
      ascending('chatId'),
      ascending('relation.targetMatrixEventId'),
      ascending('relation.applicationStatus'),
      ascending('eventTimestamp'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sourceAccountId'),
      ascending('chatId'),
      ascending('relation.targetMatrixEventId'),
      ascending('eventTimestamp'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sourceAccountId'),
      ascending('chatId'),
      ascending('messageType'),
      ascending('reaction.targetMatrixEventId'),
      ascending('eventTimestamp'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sourceAccountId'),
      ascending('chatId'),
      ascending('relation.targetMessageId'),
      ascending('relation.kind'),
      descending('eventTimestamp'),
      descending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sourceAccountId'),
      ascending('chatId'),
      ascending('relation.kind'),
      ascending('relation.targetMatrixEventId'),
      ascending('relation.applicationStatus'),
      ascending('eventTimestamp'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_conversation_assistant_context_attachments',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sessionId'),
      ascending('userId'),
      ascending('capturedAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_conversation_assistant_context_attachments',
    queryScope: 'COLLECTION',
    fields: [ascending('status'), ascending('expireAt'), ascending('__name__')],
  },
  {
    collectionGroup: 'whatsapp_conversation_assistant_context_attachments',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sessionId'),
      ascending('sessionGenerationId'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_conversation_assistant_turns',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sessionId'),
      ascending('userId'),
      ascending('sequence'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_conversation_assistant_turns',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sessionId'),
      ascending('userId'),
      ascending('conversationRevision'),
      ascending('sequence'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_conversation_assistant_turn_requests',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sessionId'),
      ascending('userId'),
      ascending('createdAt'),
      ascending('__name__'),
    ],
  },
  {
    collectionGroup: 'whatsapp_conversation_assistant_turn_requests',
    queryScope: 'COLLECTION',
    fields: [
      ascending('sessionId'),
      ascending('sessionGenerationId'),
      ascending('__name__'),
    ],
  },
];

export async function up(context) {
  console.log('  Deploying private WhatsApp journal and context attachment indexes...');
  await context.deployIndexes();
}
