/**
 * Migration 077: Composite indexes for task_group_summaries using latestTaskUpdatedAt
 *
 * PR 1604 replaced the created-time sort option (oldestTaskCreatedAt) with
 * last-updated (latestTaskUpdatedAt DESC). The query shapes now require
 * composite indexes on latestTaskUpdatedAt — both with and without the
 * aggregateStatus filter field.
 */

export const metadata = {
  id: '077',
  name: 'task-group-summaries-last-updated-indexes',
  description:
    'Composite indexes for task_group_summaries supporting last-updated sort (latestTaskUpdatedAt) with and without status filter',
  createdAt: '2026-04-03',
};

export const indexes = [
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
      { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying task_group_summaries latestTaskUpdatedAt composite indexes...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing indexes requires manual deletion via Firebase console');
}
