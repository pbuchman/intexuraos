/**
 * Migration 039: Composite index for phone verification queries by phoneNumber + createdAt
 *
 * Required for queries that filter by phoneNumber and order by createdAt.
 * Error: "The query requires an index" when verifying phone numbers.
 */

export const metadata = {
  id: '039',
  name: 'whatsapp-phone-verification-createdAt-index',
  description: 'Composite index for whatsapp_phone_verifications (phoneNumber + createdAt)',
  createdAt: '2026-01-28',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_phone_verifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'phoneNumber', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying whatsapp_phone_verifications phoneNumber + createdAt index...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing whatsapp_phone_verifications index requires manual deletion via Firebase console'
  );
}
