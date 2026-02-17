/**
 * Migration 045: Firestore security rules for log_entries subcollection
 *
 * Adds security rules for code_tasks/{taskId}/log_entries subcollection
 * to support structured execution logs migrated from plain text chunks.
 *
 * Fixes: Cannot view execution logs in production after log parsing migration
 */

export const metadata = {
  id: '045',
  name: 'log-entries-security-rules',
  description: 'Add Firestore security rules for log_entries subcollection',
  createdAt: '2026-02-10',
};

export const rules = {
  collections: {
    'code_tasks/{taskId}/log_entries/{entryId}': {
      comment: 'Log entries subcollection for structured execution logs',
      read: 'isAuthenticated()\n                  && get(/databases/$(database)/documents/code_tasks/$(taskId)).data.userId == request.auth.uid',
      write: 'false',
      writeComment: 'Write-only from backend',
    },
  },
};

export async function up(context) {
  console.log('  Deploying log_entries security rules...');
  await context.deployRules();
}
