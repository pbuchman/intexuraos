/**
 * Migration 038: Composite index for calendar_failed_events collection
 *
 * Required for queries that filter by userId and order by createdAt.
 * Used by calendar-agent's failedEventRepository.list().
 */

export const metadata = {
  id: '038',
  name: 'calendar-failed-events-index',
  description: 'Composite index for calendar_failed_events (userId + createdAt)',
  createdAt: '2026-01-28',
};

export const indexes = [
  {
    collectionGroup: 'calendar_failed_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying calendar_failed_events index...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing calendar_failed_events index requires manual deletion via Firebase console'
  );
}
