/**
 * Migration 062: Composite index for code_tasks dispatch queue listener
 *
 * Required for the Firestore real-time listener query in useDispatchQueue:
 *   .where('status', '==', 'queued')
 *   .where('userId', '==', uid)
 *   .orderBy('queuedAt', 'asc')
 *   .limit(100)
 *
 * INT-967: Fix Dispatch Queue failing due to insufficient permissions
 */

export const metadata = {
  id: '062',
  name: 'code-tasks-queue-listener-index',
  description:
    'Composite index for code_tasks (status, userId, queuedAt) for dispatch queue listener',
  createdAt: '2026-03-18',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'queuedAt', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks status+userId+queuedAt composite index...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log(
    '  Removing code_tasks status+userId+queuedAt index requires manual deletion via Firebase console'
  );
}
