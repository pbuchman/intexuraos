/**
 * Migration 070: Composite index for findPreservedPullRequestTask query
 *
 * Required for:
 *   .where('repository', '==', repository)
 *   .where('prNumber', '==', prNumber)
 *   .where('agentType', '==', 'pull_request')
 *   .where('status', '==', 'implemented')
 *   .orderBy('completedAt', 'desc')
 *   .limit(1)
 */

export const metadata = {
  id: '070',
  name: 'code-tasks-preserved-pr-completedAt-index',
  description: 'Composite index for code_tasks preserved pull_request lookup by PR with completedAt ordering',
  createdAt: '2026-03-28',
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
      { fieldPath: 'completedAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks preserved pull_request PR+completedAt composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing code_tasks preserved PR+completedAt index requires manual deletion via Firebase console'
  );
}
