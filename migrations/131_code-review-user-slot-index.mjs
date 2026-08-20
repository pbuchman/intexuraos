/**
 * Migration 131: User-scoped queued review lookup.
 *
 * The legacy review adoption path filters by repository, pull request, owner,
 * agent type, and queued status before moving the task into a deterministic
 * per-user review slot.
 */

export const metadata = {
  id: '131',
  name: 'code-review-user-slot-index',
  description: 'Composite index for user-scoped queued review task adoption',
  createdAt: '2026-08-20',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'repository', order: 'ASCENDING' },
      { fieldPath: 'prNumber', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'agentType', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['code_tasks', 'code_review_events'];

export const fieldOverrides = [
  {
    collectionGroup: 'code_review_events',
    fieldPath: 'expireAt',
    ttl: true,
    indexes: [],
  },
];

export async function up(context) {
  await context.deployIndexes();
}

export async function down() {}
