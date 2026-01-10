/**
 * Migration 017: Add updatedAt Sorting Indexes
 *
 * Adds composite indexes for sorting by updatedAt DESC instead of createdAt DESC.
 * This allows showing most recently modified items first in list views.
 *
 * Collections affected:
 * - 'bookmarks' (userId ASC, updatedAt DESC)
 * - 'todos' (userId ASC, updatedAt DESC)
 * - 'notes' (userId ASC, updatedAt DESC)
 *
 * Note: 'actions' collection already has this index from migration 001.
 */

export const metadata = {
  id: '017',
  name: 'updatedAt-sorting-indexes',
  description: 'Add composite indexes for sorting by updatedAt DESC',
  createdAt: '2026-01-10',
};

export const indexes = [
  {
    collectionGroup: 'bookmarks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'todos',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'notes',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore indexes for updatedAt sorting...');
  await context.deployIndexes();
}
