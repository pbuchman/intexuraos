/**
 * Migration 034: Additional composite indexes for code_tasks collection
 *
 * Adds supplementary indexes for deduplication and user queries.
 */

export const metadata = {
  id: '034',
  name: 'code-tasks-additional-indexes',
  description: 'Additional composite indexes for code_tasks collection',
  createdAt: '2026-01-26',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'dedupKey', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying additional code_tasks indexes...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log('  Removing additional code_tasks indexes requires manual deletion via Firebase console');
}
