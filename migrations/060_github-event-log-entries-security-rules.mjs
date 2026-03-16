/**
 * Migration 060: Firestore security rules for github-event-log-entries collection
 *
 * Adds security rules for:
 * - github-event-log-entries collection (real-time webhook event feed)
 *
 * Fixes: "Missing or insufficient permissions" error when viewing PR Events page
 */

export const metadata = {
  id: '060',
  name: 'github-event-log-entries-security-rules',
  description: 'Add Firestore security rules for github-event-log-entries collection',
  createdAt: '2026-03-13',
};

export const rules = {
  collections: {
    'github-event-log-entries/{entryId}': {
      comment: 'GitHub event log entries for real-time webhook feed',
      get: 'isAuthenticated()',
      getComment: 'No userId field — webhook-sourced docs, single-owner system',
      list: 'isAuthenticated()\n                  && request.query.limit <= 100',
      listComment: '💰 CostGuard: Query limit max 100 docs (matches LIVE_QUERY_LIMIT)',
      write: 'false',
      writeComment: 'Client cannot write (backend-only via webhook handler)',
    },
  },
};

export async function up(context) {
  console.log('  Deploying github-event-log-entries security rules...');
  await context.deployRules();
}
