/**
 * Migration 019: Data Insights updatedAt Sorting Indexes
 *
 * Adds composite indexes for sorting by updatedAt DESC for data insights.
 * This allows showing most recently modified items first in list views.
 *
 * Collections affected:
 * - 'dataSource' (userId ASC, updatedAt DESC)
 * - 'compositeFeeds' (userId ASC, updatedAt DESC)
 */

export const metadata = {
  id: '019',
  name: 'data-insights-updatedAt-indexes',
  description: 'Add composite indexes for data insights updatedAt sorting',
  createdAt: '2026-01-10',
};

export const indexes = [
  {
    collectionGroup: 'dataSource',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'compositeFeeds',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore indexes for data insights updatedAt sorting...');
  await context.deployIndexes();
}
