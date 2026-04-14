/**
 * Migration 092: Composite index for execution_memories stale pruning query
 *
 * `FirestoreExecutionMemoryRepository.listStaleUnused()` runs:
 *   .where('status', '==', 'active')
 *   .where('applicationCount', '==', 0)
 *   .where('createdAt', '<', cutoffDate)
 *
 * Without a composite index covering (status, applicationCount, createdAt),
 * Firestore returns FAILED_PRECONDITION. This migration adds the required
 * index so the P2 prune-stale endpoint works in production.
 */

export const metadata = {
  id: '092',
  name: 'execution-memories-stale-pruning-index',
  description:
    'Composite index for execution_memories stale pruning query (status, applicationCount, createdAt)',
  createdAt: '2026-04-12',
};

export const indexes = [
  {
    collectionGroup: 'execution_memories',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'applicationCount', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['execution_memories'];

export async function up(context) {
  console.log('  Deploying execution_memories stale pruning composite index (1 index)...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing execution_memories stale pruning index requires manual deletion via Firebase console'
  );
}
