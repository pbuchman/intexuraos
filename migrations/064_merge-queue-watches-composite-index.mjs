/**
 * Migration 064: Composite index for merge_queue_watches collection
 *
 * Required for:
 * - findActiveByUserAndBranch: userId + owner + repo + baseBranch + status
 */

export const metadata = {
  id: '064',
  name: 'merge-queue-watches-composite-index',
  description: 'Composite index for merge_queue_watches findActiveByUserAndBranch query',
  createdAt: '2026-03-20',
};

export const indexes = [
  {
    collectionGroup: 'merge_queue_watches',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'owner', order: 'ASCENDING' },
      { fieldPath: 'repo', order: 'ASCENDING' },
      { fieldPath: 'baseBranch', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['merge_queue_watches'];

export async function up(context) {
  console.log('  Deploying merge queue watches composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing merge queue indexes requires manual deletion via Firebase console');
}
