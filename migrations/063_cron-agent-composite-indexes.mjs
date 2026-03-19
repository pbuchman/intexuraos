/**
 * Migration 063: Composite indexes for cron-agent service
 *
 * Required for:
 * - findDueSchedules: status + nextExecutionAt
 * - findByUserId (schedules): userId + status + createdAt
 * - findByUserId (executions): userId + createdAt, userId + status + createdAt
 * - findByScheduleId (executions): scheduleId + createdAt, scheduleId + status + createdAt
 */

export const metadata = {
  id: '063',
  name: 'cron-agent-composite-indexes',
  description: 'Composite indexes for cron_schedules and cron_executions collections',
  createdAt: '2026-03-18',
};

export const indexes = [
  {
    collectionGroup: 'cron_schedules',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'nextExecutionAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'cron_schedules',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'cron_executions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'cron_executions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'scheduleId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'cron_executions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'cron_executions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'scheduleId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['cron_schedules', 'cron_executions'];

export async function up(context) {
  console.log('  Deploying cron-agent composite indexes...');
  await context.deployIndexes();
}

export async function down(context) {
  console.log('  Removing cron-agent indexes requires manual deletion via Firebase console');
}
