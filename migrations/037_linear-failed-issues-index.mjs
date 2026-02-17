/**
 * Migration 037: Composite index for linear_failed_issues collection
 *
 * Required for queries that filter by userId and order by createdAt.
 * Used by linear-agent's failedIssueRepository.listByUser().
 */

export const metadata = {
  id: '037',
  name: 'linear-failed-issues-index',
  description: 'Composite index for linear_failed_issues (userId + createdAt)',
  createdAt: '2026-01-28',
};

export const indexes = [
  {
    collectionGroup: 'linear_failed_issues',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying linear_failed_issues index...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing linear_failed_issues index requires manual deletion via Firebase console'
  );
}
