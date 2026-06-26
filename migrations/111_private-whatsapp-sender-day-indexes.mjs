/**
 * Migration 111: Private WhatsApp sender-day indexes.
 *
 * Required by:
 * - whatsapp-service private message time-range queries
 * - whatsapp-service private sender profile list queries
 * - whatsapp-service private sender-day aggregate queries for future daily summaries
 */

export const metadata = {
  id: '111',
  name: 'private-whatsapp-sender-day-indexes',
  description: 'Composite indexes for private WhatsApp sender and sender-day queries',
  createdAt: '2026-06-23',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'senderKey', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'eventDayKey', order: 'ASCENDING' },
      { fieldPath: 'senderKey', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_senders',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'lastEventAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_sender_days',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'eventDayKey', order: 'DESCENDING' },
      { fieldPath: 'senderKey', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_sender_days',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'senderKey', order: 'ASCENDING' },
      { fieldPath: 'eventDayKey', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying private WhatsApp sender-day indexes...');
  await context.deployIndexes();
}
