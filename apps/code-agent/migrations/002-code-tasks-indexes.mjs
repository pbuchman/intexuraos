/**
 * Composite indexes for code_tasks collection.
 * Required for deduplication and zombie detection queries.
 */

export const indexes = [
  {
    collection: 'code_tasks',
    fields: [
      { field: 'dedupKey', order: 'ASCENDING' },
      { field: 'createdAt', order: 'ASCENDING' },
    ],
  },
  {
    collection: 'code_tasks',
    fields: [
      { field: 'linearIssueId', order: 'ASCENDING' },
      { field: 'status', order: 'ASCENDING' },
    ],
  },
  {
    collection: 'code_tasks',
    fields: [
      { field: 'status', order: 'ASCENDING' },
      { field: 'updatedAt', order: 'ASCENDING' },
    ],
  },
  {
    collection: 'code_tasks',
    fields: [
      { field: 'userId', order: 'ASCENDING' },
      { field: 'createdAt', order: 'DESCENDING' },
    ],
  },
];
