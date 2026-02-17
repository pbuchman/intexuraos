/**
 * Migration 041: Firestore security rules for code_tasks collection
 *
 * Adds security rules for:
 * - code_tasks collection (real-time task status)
 * - code_tasks/{taskId}/logs subcollection (execution logs)
 *
 * Fixes: "Missing or insufficient permissions" error when viewing task logs
 */

export const metadata = {
  id: '041',
  name: 'code-tasks-security-rules',
  description: 'Add Firestore security rules for code_tasks and logs subcollection',
  createdAt: '2026-02-03',
};

export const rules = {
  collections: {
    'code_tasks/{taskId}': {
      comment: 'Code tasks for real-time status updates',
      get: 'isOwner(resource.data.userId)',
      list: 'isAuthenticated()\n                  && request.query.limit <= 100\n                  && resource.data.userId == request.auth.uid',
      listComment: '💰 CostGuard: Query limit max 100 docs',
      write: 'false',
      writeComment: 'Client cannot write (backend-only)',
    },
    'code_tasks/{taskId}/logs/{logId}': {
      comment: 'Logs subcollection for real-time execution logs',
      read: 'isAuthenticated()\n                    && get(/databases/$(database)/documents/code_tasks/$(taskId)).data.userId == request.auth.uid',
      readComment: 'Allow read if parent task belongs to user',
      write: 'false',
      writeComment: 'Client cannot write (backend-only)',
    },
  },
};

export async function up(context) {
  console.log('  Deploying code_tasks security rules...');
  await context.deployRules();
}
