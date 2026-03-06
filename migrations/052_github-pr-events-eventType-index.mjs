/**
 * Migration 052: Composite index for github-pr-events review comment queries
 *
 * Required for findReviewComments query:
 *   .where('repository', '==', ...)
 *   .where('pullRequestNumber', '==', ...)
 *   .where('eventType', '==', 'pull_request_review_comment')
 *   .orderBy('createdAt', 'asc')
 *
 * INT-631: Enrich PR review events with inline comments
 */

export const metadata = {
  id: '052',
  name: 'github-pr-events-eventType-index',
  description:
    'Composite index for github-pr-events (repository, pullRequestNumber, eventType, createdAt) for review comment queries',
  createdAt: '2026-02-28',
};

export const indexes = [
  {
    collectionGroup: 'github-pr-events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'repository', order: 'ASCENDING' },
      { fieldPath: 'pullRequestNumber', order: 'ASCENDING' },
      { fieldPath: 'eventType', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['github-pr-events'];

export async function up(context) {
  console.log('  Deploying github-pr-events eventType composite index...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log(
    '  Removing github-pr-events eventType index requires manual deletion via Firebase console'
  );
}
