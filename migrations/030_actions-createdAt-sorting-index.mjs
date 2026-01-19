/**
 * Migration 030: Actions createdAt Sorting Index
 *
 * Adds composite index for filtering actions by status while sorting by createdAt.
 * Required for listByUserId() with status filter in actions-agent after INT-163.
 *
 * Query pattern: where(userId) + where(status in [...]) + orderBy(createdAt DESC)
 *
 * This replaces the updatedAt sorting with createdAt to prevent confusing
 * ordering when actions are updated (e.g., approved) - the user expects to see
 * actions in chronological order of creation, not last modification.
 */

export const metadata = {
  id: '030',
  name: 'actions-createdAt-sorting-index',
  description: 'Add composite index for actions filtered by status and sorted by createdAt',
  createdAt: '2026-01-19',
};

export const indexes = [
  {
    collectionGroup: 'actions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore index for actions createdAt sorting...');
  await context.deployIndexes();
}
