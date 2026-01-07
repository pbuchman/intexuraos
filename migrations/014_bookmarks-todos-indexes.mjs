/**
 * Migration 014: Bookmarks and Todos Collection Indexes
 *
 * Adds composite indexes for:
 * - 'bookmarks' collection (userId ASC, createdAt DESC)
 * - 'todos' collection (userId ASC, createdAt DESC)
 *
 * These indexes are required for queries that filter by userId and order by createdAt.
 */

export const metadata = {
  id: '014',
  name: 'bookmarks-todos-indexes',
  description: 'Add composite indexes for bookmarks and todos collections',
  createdAt: '2026-01-07',
};

export const indexes = [
  {
    collectionGroup: 'bookmarks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'todos',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore indexes for bookmarks and todos...');
  await context.deployIndexes();
}
