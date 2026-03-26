/**
 * Migration 069: Composite index for findRecentRemediationForPR query
 *
 * Required for:
 *   .where('repository', '==', repository)
 *   .where('prNumber', '==', prNumber)
 *   .where('agentType', '==', 'remediation')
 *   .orderBy('createdAt', 'desc')
 *   .limit(1)
 */

export const metadata = {
  id: '069',
  name: 'code-tasks-remediation-pr-createdAt-index',
  description: 'Composite index for code_tasks remediation lookup by PR with createdAt ordering',
  createdAt: '2026-03-26',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'repository', order: 'ASCENDING' },
      { fieldPath: 'prNumber', order: 'ASCENDING' },
      { fieldPath: 'agentType', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks remediation PR+createdAt composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing code_tasks remediation PR+createdAt index requires manual deletion via Firebase console'
  );
}
