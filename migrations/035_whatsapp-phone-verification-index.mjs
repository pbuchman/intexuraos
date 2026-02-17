/**
 * Migration 035: Composite index for phone verification queries
 *
 * Required for the findPendingByUserAndPhone query which uses:
 * - where('userId', '==', userId)
 * - where('phoneNumber', '==', phoneNumber)
 * - where('status', '==', 'pending')
 * - where('expiresAt', '>', now)
 * - orderBy('expiresAt', 'desc')
 */

export const metadata = {
  id: '035',
  name: 'whatsapp-phone-verification-index',
  description: 'Composite index for finding pending verifications by user and phone',
  createdAt: '2026-01-26',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_phone_verifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'phoneNumber', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'expiresAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying whatsapp phone verification composite index...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log(
    '  Removing whatsapp phone verification index requires manual deletion via Firebase console'
  );
}
