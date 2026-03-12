/**
 * Migration 056: Composite index for code_tasks same-ticket history lookup
 *
 * Retry continuity scans recent tasks for a Linear issue to recover
 * an open PR even when the immediate retry lineage has already been archived.
 *
 * Query: where('linearIssueId', '==', id).orderBy('createdAt', 'desc').limit(20)
 */

export const metadata = {
  id: '056',
  name: 'code-tasks-linear-issue-createdAt-index',
  description: 'Composite index for code_tasks same-ticket history lookup',
  createdAt: '2026-03-11',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'linearIssueId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks Linear issue + createdAt composite index...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log(
    '  Removing code_tasks Linear issue + createdAt index requires manual deletion via Firebase console'
  );
}
