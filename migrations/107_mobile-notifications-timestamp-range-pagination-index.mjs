/**
 * Migration 107: Composite index for timestamp-range notification pagination,
 * plus code-task dispatch system status security rules.
 *
 * Required by call path:
 *   /internal/notifications/group-messages/query -> NotificationRepository.findByUserIdPaginated
 *   filter: app + userId + timestamp range, order: timestamp desc + __name__ desc.
 */

export const metadata = {
  id: '107',
  name: 'mobile-notifications-timestamp-range-pagination-index',
  description:
    'Composite index for mobile notification timestamp-range pagination and code-task system status rules',
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

export const rules = {
  collections: {
    'code_task_system_statuses/{statusId}': {
      comment: 'User-visible code task dispatch blocker system statuses',
      get: 'isOwner(resource.data.userId)',
      list: 'isAuthenticated()\n                  && request.query.limit <= 50\n                  && resource.data.userId == request.auth.uid',
      listComment: 'CostGuard: Query limit max 50 docs',
      write: 'false',
      writeComment: 'Client cannot write (backend-only)',
    },
  },
};

export const collections = ['mobile_notifications', 'code_task_system_statuses'];

export async function up(context) {
  console.log('  Deploying mobile_notifications timestamp-range pagination composite index...');
  await context.deployIndexes();
  console.log('  Deploying code_task_system_statuses security rules...');
  await context.deployRules();
}

export async function down() {
  console.log('  Removing the composite index requires manual deletion via Firebase console');
}
