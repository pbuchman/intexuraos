/**
 * Migration 051: Composite index for code_tasks queued task drain queries
 *
 * Required for drainTaskQueue query:
 *   .where('status', '==', 'queued')
 *   .orderBy('createdAt', 'asc')
 *   .limit(1)
 *
 * INT-619: Task queueing when workers are at capacity
 */

export const metadata = {
  id: '051',
  name: 'code-tasks-status-createdAt-index',
  description: 'Composite index for code_tasks (status, createdAt) for queue drain queries',
  createdAt: '2026-02-28',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks status+createdAt composite index...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log(
    '  Removing code_tasks status+createdAt index requires manual deletion via Firebase console'
  );
}
