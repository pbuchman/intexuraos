/**
 * Migration 123: Private WhatsApp literal legacy-reaction field index.
 *
 * Required by the private chat reaction query. Firestore requested the literal
 * escaped field path below, which is distinct from the normalized
 * rawMatrixEvent.content.`m.relates_to`.event_id index declared by migration 121.
 */

export const metadata = {
  id: '123',
  name: 'private-whatsapp-literal-reaction-index',
  description: 'Composite index required by private WhatsApp legacy reaction reads',
  createdAt: '2026-07-19',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      {
        fieldPath: 'rawMatrixEvent.content.`\\`m`.`relates_to\\``.event_id',
        order: 'ASCENDING',
      },
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying private WhatsApp literal legacy-reaction index...');
  await context.deployIndexes();
}
