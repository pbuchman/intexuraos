/**
 * Migration 042: Firestore indexes for github-pr-events collection
 *
 * Creates composite indexes required for GitHub PR event queries.
 * Design reference: docs/features/github-pr-events-aggregation.md
 *
 * IMPORTANT: These indexes are REQUIRED for queries to work in production.
 * Without them, queries will fail with "requires an index" error.
 */

export const metadata = {
  id: '042',
  name: 'github-pr-events-indexes',
  description: 'Firestore indexes for github-pr-events collection',
  createdAt: '2026-02-05',
};

export const indexes = [
  // PR timeline query: get all events for a specific PR, ordered newest first
  // Query: where('repository', '==', repo).where('pullRequestNumber', '==', pr).orderBy('createdAt', 'desc')
  {
    collectionGroup: 'github-pr-events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'repository', order: 'ASCENDING' },
      { fieldPath: 'pullRequestNumber', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },

  // Repository activity query: get recent events across all PRs in a repository
  // Query: where('repository', '==', repo).orderBy('createdAt', 'desc')
  {
    collectionGroup: 'github-pr-events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'repository', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },

  // Deduplication check: prevent storing duplicate events on webhook retry
  // Query: where('githubEventId', '==', eventId).limit(1)
  {
    collectionGroup: 'github-pr-events',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'githubEventId', order: 'ASCENDING' }],
  },
];

export const collections = ['github-pr-events'];

export async function up(context) {
  console.log('  Deploying github-pr-events indexes...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log('  Removing github-pr-events indexes requires manual deletion via Firebase console');
}
