/**
 * Migration 106: Composite indexes for task_group_summaries numeric linear-id sort.
 *
 * INT-1606 replaces lexicographic linearIssueId ordering with the numeric
 * linearIssueSortKey field and latestTaskUpdatedAt tie-breaker.
 */

export const metadata = {
  id: '106',
  name: 'task-group-summaries-linear-sort-key-indexes',
  description:
    'Composite indexes for task_group_summaries supporting numeric linear-id sort with latest-task tie-breaker',
  createdAt: '2026-05-06',
};

export const indexes = [
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
      { fieldPath: 'linearIssueSortKey', order: 'DESCENDING' },
      { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'linearIssueSortKey', order: 'DESCENDING' },
      { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying task_group_summaries linearIssueSortKey composite indexes...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing indexes requires manual deletion via Firebase console');
}
