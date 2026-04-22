/**
 * Migration 096: Composite index for digest time-range queries
 *
 * Required by mobile-notifications-service runDigestForGroup for:
 *   findByUserIdPaginated with filter: { app: ['com.whatsapp'],
 *                                        postTimeSecFrom, postTimeSecTo }
 *
 * Firestore error: "9 FAILED_PRECONDITION: The query requires an index"
 * Observed in dev 2026-04-17 15:26:40 UTC (trace 76fb31300b10d8477e0cf4e46ab9e07c).
 *
 * See INT-1412 for context.
 */

export const metadata = {
  id: '096',
  name: 'mobile-notifications-digest-time-range-index',
  description: 'Composite index for app + userId + receivedAt + timestamp digest query',
  createdAt: '2026-04-17',
};

export const indexes = [
  {
    collectionGroup: 'mobile_notifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'app', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'receivedAt', order: 'DESCENDING' },
      { fieldPath: 'timestamp', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['mobile_notifications'];

export async function up(context) {
  console.log('  Deploying mobile_notifications digest time-range composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing the composite index requires manual deletion via Firebase console');
}
