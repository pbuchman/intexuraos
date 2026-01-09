/**
 * Migration 016: Composite Feed Snapshots Index
 *
 * Adds composite index for 'composite_feed_snapshots' collection to support
 * listByUserId query which filters by userId and orders by generatedAt DESC.
 *
 * Query: .where('userId', '==', userId).orderBy('generatedAt', 'desc')
 */

export const metadata = {
  id: '016',
  name: 'snapshot-userid-generatedat-index',
  description: 'Add composite index for composite_feed_snapshots (userId, generatedAt)',
  createdAt: '2026-01-09',
};

export const indexes = [
  {
    collectionGroup: 'composite_feed_snapshots',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'generatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore indexes (adds composite_feed_snapshots index)...');
  await context.deployIndexes();
}
