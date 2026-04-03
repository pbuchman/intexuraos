/**
 * Migration 076: Composite indexes for task_group_summaries without status filter
 *
 * Migration 072 defines composite indexes that all include aggregateStatus as
 * the second field. When no groupStatus filter is applied, the query shape
 * (userId == X + orderBy <sortField>) has no matching composite index, causing
 * a FAILED_PRECONDITION error. This migration adds 4 indexes — one per sort
 * option — that omit aggregateStatus.
 */

export const metadata = {
  id: '076',
  name: 'task-group-summaries-unfiltered-indexes',
  description:
    'Composite indexes for task_group_summaries supporting unfiltered queries with multiple sort options (linear-id, pr-number, created-time, started-time)',
  createdAt: '2026-04-03',
};

export const indexes = [
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'linearIssueId', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'prNumber', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'oldestTaskCreatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'mostRecentDispatchedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying task_group_summaries unfiltered composite indexes...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing indexes requires manual deletion via Firebase console');
}
