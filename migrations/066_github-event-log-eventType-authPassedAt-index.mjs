/**
 * Migration 066: Composite index for github-event-log-entries collection
 *
 * Required for:
 * - listRecent with eventType filter: eventType IN [...] + authPassedAt DESC
 */

export const metadata = {
  id: '066',
  name: 'github-event-log-eventType-authPassedAt-index',
  description: 'Composite index for github-event-log-entries eventType + authPassedAt query',
  createdAt: '2026-03-21',
};

export const indexes = [
  {
    collectionGroup: 'github-event-log-entries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'eventType', order: 'ASCENDING' },
      { fieldPath: 'authPassedAt', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['github-event-log-entries'];

export async function up(context) {
  console.log('  Deploying github-event-log-entries eventType + authPassedAt composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing github-event-log-entries indexes requires manual deletion via Firebase console'
  );
}
