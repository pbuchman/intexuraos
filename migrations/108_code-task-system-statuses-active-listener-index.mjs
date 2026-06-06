/**
 * Migration 108: Code task system status active listener index and rules.
 *
 * Required by apps/web/src/hooks/useDispatchQueue:
 *   filter: userId + status.
 */

export const metadata = {
  id: '108',
  name: 'code-task-system-statuses-active-listener-index',
  description:
    'Composite index and backend-owned rules for code_task_system_statuses active listener queries',
  createdAt: '2026-06-06',
};

export const indexes = [
  {
    collectionGroup: 'code_task_system_statuses',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['code_task_system_statuses'];

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

export async function up(context) {
  console.log('  Deploying code_task_system_statuses userId+status composite index...');
  await context.deployIndexes();
  console.log('  Deploying code_task_system_statuses security rules...');
  await context.deployRules();
}

export async function down() {
  console.log(
    '  Removing code_task_system_statuses index requires manual deletion via Firebase console'
  );
}
