/**
 * Migration 021: Add updatedAt Sorting Index for Mobile Notifications
 *
 * Adds composite index for sorting mobile notifications by updatedAt DESC.
 * Changed from createdAt to updatedAt to show recently updated notifications first.
 *
 * Collections affected:
 * - 'mobile_notifications' (userId ASC, updatedAt DESC)
 */

export const metadata = {
  id: '021',
  name: 'mobile-notifications-updatedAt-index',
  description: 'Add composite index for mobile_notifications updatedAt sorting',
  createdAt: '2026-01-11',
};

export const indexes = [
  {
    collectionGroup: 'mobile_notifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore index for mobile_notifications updatedAt sorting...');
  await context.deployIndexes();
}
