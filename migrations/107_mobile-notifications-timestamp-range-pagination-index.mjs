/**
 * Migration 107: Composite index for timestamp-range notification pagination.
 *
 * Required by call path:
 *   /internal/notifications/group-messages/query -> NotificationRepository.findByUserIdPaginated
 *   filter: app + userId + timestamp range, order: timestamp desc + __name__ desc.
 */

export const metadata = {
  id: '107',
  name: 'mobile-notifications-timestamp-range-pagination-index',
  description: 'Composite index for mobile notification timestamp-range pagination',
  createdAt: '2026-05-12',
};

export const indexes = [
  {
    collectionGroup: 'mobile_notifications',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'app', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'timestamp', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
];

export const collections = ['mobile_notifications'];

export async function up(context) {
  console.log('  Deploying mobile_notifications timestamp-range pagination composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing the composite index requires manual deletion via Firebase console');
}
