/**
 * Migration 020: Custom Data Sources updatedAt Sorting Index
 *
 * Adds composite index for sorting by updatedAt DESC for custom data sources.
 * This allows showing most recently modified items first in list views.
 *
 * Collections affected:
 * - 'custom_data_sources' (userId ASC, updatedAt DESC)
 */

export const metadata = {
  id: '020',
  name: 'custom-data-sources-updatedAt-index',
  description: 'Add composite index for custom_data_sources updatedAt sorting',
  createdAt: '2026-01-11',
};

export const indexes = [
  {
    collectionGroup: 'custom_data_sources',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore index for custom_data_sources updatedAt sorting...');
  await context.deployIndexes();
}
