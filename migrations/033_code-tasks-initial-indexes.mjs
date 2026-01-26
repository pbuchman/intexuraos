/**
 * Migration 033: Initial Firestore indexes for code_tasks collection
 *
 * Creates composite indexes required for code-agent queries.
 * Design reference: docs/designs/INT-156-code-action-type.md
 *
 * IMPORTANT: These indexes are REQUIRED for queries to work in production.
 * Without them, queries will fail with "requires an index" error.
 */

export const metadata = {
  id: '033',
  name: 'code-tasks-initial-indexes',
  description: 'Initial Firestore indexes for code_tasks collection',
  createdAt: '2026-01-26',
};

export const indexes = [
  // Zombie detection: find stale running tasks
  // Query: where('status', '==', 'running').where('updatedAt', '<', thirtyMinutesAgo)
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'ASCENDING' },
    ],
  },

  // Single task per Linear issue enforcement
  // Query: where('linearIssueId', '==', id).where('status', 'in', ['dispatched', 'running'])
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'linearIssueId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ],
  },

  // User task listing: filter by user and status, sort by date
  // Query: where('userId', '==', uid).where('status', '==', status).orderBy('createdAt', 'desc')
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },

  // Deduplication check
  // Query: where('dedupKey', '==', key).where('createdAt', '>', fiveMinutesAgo)
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'dedupKey', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },

  // Log chunks ordering
  // Query: orderBy('sequence', 'asc')
  {
    collectionGroup: 'logs',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'sequence', order: 'ASCENDING' }],
  },
];

export const collections = ['code_tasks', 'user_spend'];

export async function up(context) {
  console.log('  Creating code_tasks indexes...');
  console.log('  Note: Firestore indexes are created via Firebase console or gcloud CLI');
  console.log('  Run: gcloud firestore indexes composite create --collection-group=code_tasks ...');
}

export async function down(context) {
  console.log('  Removing code_tasks indexes...');
  console.log('  Note: Firestore indexes must be deleted via Firebase console or gcloud CLI');
}
