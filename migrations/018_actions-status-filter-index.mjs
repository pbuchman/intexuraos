/**
 * Migration 018: Add Actions Status Filter Index
 *
 * Adds composite index for filtering actions by status while sorting by updatedAt.
 * Required for listByUserId() with status filter in actions-agent.
 *
 * Query pattern: where(userId) + where(status in [...]) + orderBy(updatedAt DESC)
 */

export const metadata = {
  id: '018',
  name: 'actions-status-filter-index',
  description: 'Add composite index for actions filtered by status and sorted by updatedAt',
  createdAt: '2026-01-10',
};

export const indexes = [
  {
    collectionGroup: 'actions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore index for actions status filtering...');
  await context.deployIndexes();
}
