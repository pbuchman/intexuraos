/**
 * Migration 120: Calendar schedule indexes.
 */

export const metadata = {
  id: '120',
  name: 'calendar-schedules-indexes',
  description: 'Indexes for calendar schedule lookups, due claims, and run history',
  createdAt: '2026-07-04',
};

export const collections = ['calendar_schedules', 'calendar_schedule_runs'];

export const indexes = [
  {
    collectionGroup: 'calendar_schedules',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'nextRunAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'calendar_schedules',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'taskType', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'calendar_schedule_runs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'scheduleId', order: 'ASCENDING' },
      { fieldPath: 'startedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'calendar_schedule_runs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'startedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying calendar schedule indexes...');
  await context.deployIndexes();
}
