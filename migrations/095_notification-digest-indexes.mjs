/**
 * Migration 095: Composite indexes for notification digest queries
 *
 * Required by mobile-notifications-service for:
 * - findByDate: userId + groupKey + date
 * - findRecentByGroup: userId + groupKey + generatedAt desc
 * - findInRange: userId + groupKey + date range
 * - getByDate (GroupState): userId + groupKey + date
 *
 * See INT-1382 for context.
 */

export const metadata = {
  id: '095',
  name: 'notification-digest-indexes',
  description: 'Composite indexes for notification digest queries',
  createdAt: '2026-04-17',
};

export const indexes = [
  // notification_daily_digests: userId + groupKey + date (for findByDate, findInRange)
  {
    collectionGroup: 'notification_daily_digests',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'groupKey', order: 'ASCENDING' },
      { fieldPath: 'date', order: 'DESCENDING' },
    ],
  },
  // notification_group_states: userId + groupKey + date (for getByDate, getLatest)
  {
    collectionGroup: 'notification_group_states',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'groupKey', order: 'ASCENDING' },
      { fieldPath: 'date', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['notification_daily_digests', 'notification_group_states'];

export async function up(context) {
  console.log('  Deploying notification digest composite indexes (2 indexes)...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing notification digest indexes requires manual deletion via Firebase console'
  );
}
