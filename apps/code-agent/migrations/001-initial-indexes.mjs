/**
 * Initial Firestore indexes for code_tasks collection.
 * Design reference: Lines 2114-2150
 *
 * IMPORTANT: These indexes are REQUIRED for queries to work in production.
 * Without them, queries will fail with "requires an index" error.
 */
export const indexes = [
  // Zombie detection: find stale running tasks
  // Query: where('status', '==', 'running').where('updatedAt', '<', thirtyMinutesAgo)
  // Design reference: Line 2148
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
  // Design reference: Lines 448-458
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
  // Design reference: Line 2145
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
  // Design reference: Line 2146
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
  // Design reference: Line 2147
  {
    collectionGroup: 'logs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sequence', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['code_tasks', 'user_spend'];
