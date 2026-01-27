/**
 * Migration 036: Composite index for log cleanup queries
 *
 * Adds index for queries that filter by completedAt and logsArchived
 * Used by the log-cleanup Cloud Function.
 */

export const metadata = {
  id: '036',
  name: 'code-tasks-log-cleanup-index',
  description: 'Composite index for log cleanup queries on code_tasks collection',
  createdAt: '2026-01-27',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'logsArchived', order: 'ASCENDING' },
      { fieldPath: 'completedAt', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying code_tasks log cleanup index...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log(
    '  Removing code_tasks log cleanup index requires manual deletion via Firebase console'
  );
}
