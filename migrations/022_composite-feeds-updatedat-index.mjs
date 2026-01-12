/**
 * Migration 022: Composite Feeds UpdatedAt Index
 *
 * - Adds composite index for 'composite_feeds' collection (userId ASC, updatedAt DESC, __name__ DESC)
 * - Required for queries that filter by userId and order by updatedAt
 */

export const metadata = {
  id: '022',
  name: 'composite-feeds-updatedat-index',
  description: 'Add composite_feeds index with updatedAt sorting',
  createdAt: '2026-01-13',
};

export const indexes = [
  {
    collectionGroup: 'composite_feeds',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore index for composite_feeds (userId, updatedAt)...');
  await context.deployIndexes();
}
