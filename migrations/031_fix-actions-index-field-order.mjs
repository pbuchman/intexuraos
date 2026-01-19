/**
 * Migration 031: Fix Actions Index Field Order
 *
 * Corrects the composite index field order from migration 030.
 * The previous index had fields in wrong order (status, userId, createdAt)
 * but the query pattern requires (userId, status, createdAt).
 *
 * For Firestore composite indexes with an `in` clause, field order must match:
 * 1. Equality filters first (userId)
 * 2. Then the `in` clause field (status)
 * 3. Finally the orderBy field (createdAt)
 *
 * Query pattern: where(userId ==) + where(status in [...]) + orderBy(createdAt DESC)
 */

export const metadata = {
  id: '031',
  name: 'fix-actions-index-field-order',
  description: 'Fix composite index field order to match query pattern',
  createdAt: '2026-01-19',
};

export const indexes = [
  {
    collectionGroup: 'actions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying corrected Firestore index for actions...');
  await context.deployIndexes();
}
