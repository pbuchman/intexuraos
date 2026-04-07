/**
 * Migration 068: Composite index for merge_queue_watches findByUserAndRepo query
 *
 * Required for:
 * - findByUserAndRepo: userId + owner + repo + createdAt (desc)
 */

export const metadata = {
  id: '068',
  name: 'merge-queue-watches-findByUserAndRepo-index',
  description:
    'Composite index for merge_queue_watches findByUserAndRepo query with createdAt ordering',
  createdAt: '2026-03-23',
};

export const indexes = [
  {
    collectionGroup: 'merge_queue_watches',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'owner', order: 'ASCENDING' },
      { fieldPath: 'repo', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['merge_queue_watches'];

export async function up(context) {
  console.log('  Deploying merge queue watches findByUserAndRepo composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing merge queue indexes requires manual deletion via Firebase console');
}
