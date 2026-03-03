/**
 * Migration 054: Composite index for linear_issues (identifier + userId)
 *
 * The findByIdentifier query was updated to accept an optional userId parameter
 * for user-scoped lookups. When both identifier and userId are provided,
 * Firestore needs a composite index for the compound equality query.
 *
 * Note: findUserIdsByIssueId uses a single-field query (.where('id', '==', ...))
 * which is auto-indexed by Firestore — no manual index needed.
 */

export const metadata = {
  id: '054',
  name: 'linear-issues-userid-indexes',
  description: 'Composite index for linear_issues (identifier + userId) for user-scoped lookups',
  createdAt: '2026-03-03',
};

export const indexes = [
  {
    collectionGroup: 'linear_issues',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'identifier', order: 'ASCENDING' },
      { fieldPath: 'userId', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying linear_issues composite index (identifier + userId)...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing index requires manual deletion via Firebase console');
}
