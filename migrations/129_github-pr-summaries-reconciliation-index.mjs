/**
 * Migration 129: Composite index for bounded merge-conflict reconciliation
 *
 * Required for the reconciliation candidate query:
 *   .where('state', '==', 'open')
 *   .orderBy('lastConflictCheckedAt', 'asc')
 *   .limit(10)
 */

export const metadata = {
  id: '129',
  name: 'github-pr-summaries-reconciliation-index',
  description:
    'Composite index for oldest-first open GitHub PR summary reconciliation',
  createdAt: '2026-08-10',
};

export const indexes = [
  {
    collectionGroup: 'github-pr-summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'state', order: 'ASCENDING' },
      { fieldPath: 'lastConflictCheckedAt', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['github-pr-summaries'];

export async function up(context) {
  await context.deployIndexes();
}

export async function down() {}
