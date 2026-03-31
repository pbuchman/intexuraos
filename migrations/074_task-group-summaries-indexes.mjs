/**
 * Migration 074: Composite indexes for task_group_summaries collection
 *
 * The task_group_summaries collection supports listing groups filtered by
 * aggregateStatus and sorted by multiple fields (updatedAt, oldestTaskCreatedAt,
 * mostRecentDispatchedAt, linearIssueId). Each sort field requires a composite
 * index because Firestore cannot combine inequality/equality filters with
 * ordering across different fields without an explicit index.
 *
 * Renumbered from 072 to 074 during merge conflict resolution — the PR branch
 * (execution-memory-graph) had already claimed 072 and 073.
 */

export const metadata = {
  id: '074',
  name: 'task-group-summaries-indexes',
  description:
    'Composite indexes for task_group_summaries supporting status-filtered queries with multiple sort options (updatedAt, created-time, started-time, linear-id)',
  createdAt: '2026-03-31',
};

export const indexes = [
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
      { fieldPath: 'oldestTaskCreatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
      { fieldPath: 'mostRecentDispatchedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
      { fieldPath: 'linearIssueId', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying task_group_summaries composite indexes...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing indexes requires manual deletion via Firebase console');
}
