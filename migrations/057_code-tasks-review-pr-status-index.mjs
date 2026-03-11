/**
 * Migration 057: Composite index for active review-task lookup by PR
 *
 * Required for findActiveReviewForPR query:
 *   .where('repository', '==', repo)
 *   .where('prNumber', '==', pr)
 *   .where('agentType', '==', 'review')
 *   .where('status', 'in', ['queued', 'dispatched', 'running'])
 *   .limit(1)
 */

export const metadata = {
  id: '057',
  name: 'code-tasks-review-pr-status-index',
  description: 'Composite index for code_tasks active review-task lookup by PR',
  createdAt: '2026-03-11',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'repository', order: 'ASCENDING' },
      { fieldPath: 'prNumber', order: 'ASCENDING' },
      { fieldPath: 'agentType', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks review PR+status composite index...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log(
    '  Removing code_tasks review PR+status index requires manual deletion via Firebase console'
  );
}
