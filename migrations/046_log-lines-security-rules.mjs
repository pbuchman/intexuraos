/**
 * Migration 046: Firestore security rules for log_lines subcollection
 *
 * Adds security rules for code_tasks/{taskId}/log_lines subcollection
 * to allow the web UI to read formatted execution logs.
 *
 * Migration 045 added log_entries but missed log_lines which is the
 * subcollection actually consumed by the TerminalLogViewer component.
 */

export const metadata = {
  id: '046',
  name: 'log-lines-security-rules',
  description: 'Add Firestore security rules for log_lines subcollection',
  createdAt: '2026-02-10',
};

export const rules = {
  collections: {
    'code_tasks/{taskId}/log_lines/{lineId}': {
      comment: 'Log lines subcollection for formatted execution logs',
      read: 'isAuthenticated()\n                  && get(/databases/$(database)/documents/code_tasks/$(taskId)).data.userId == request.auth.uid',
      write: 'false',
      writeComment: 'Write-only from backend',
    },
  },
};

export async function up(context) {
  console.log('  Deploying log_lines security rules...');
  await context.deployRules();
}
