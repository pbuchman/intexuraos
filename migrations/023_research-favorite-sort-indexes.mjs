/**
 * Migration 023: Research Favorite Sorting Indexes
 *
 * Adds Firestore composite indexes for querying researches by favorite status.
 * This enables sorting favorites before non-favorites in the research list.
 */

export const metadata = {
  id: '023',
  name: 'research-favorite-sort-indexes',
  description: 'Add indexes for research favorite-first sorting',
  createdAt: '2026-01-13',
};

export const indexes = [
  {
    collectionGroup: 'researches',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'favourite', order: 'ASCENDING' },
      { fieldPath: 'startedAt', order: 'DESCENDING' },
    ],
  },
];

export const rules = {};

export async function up(context) {
  console.log('  Deploying research favorite sorting indexes...');
  await context.deployIndexes();
}
