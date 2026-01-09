/**
 * Migration 015: Usage Stats User Collection Group Index
 *
 * Adds a collection group index for the 'by_user' subcollection to enable
 * querying all user usage stats across all models and call types.
 *
 * Path structure: llm_usage_stats/{model}/by_call_type/{callType}/by_period/{period}/by_user/{userId}
 *
 * This index is required for the GET /settings/usage-costs endpoint which uses
 * a collection group query to fetch all usage data for a specific user.
 */

export const metadata = {
  id: '015',
  name: 'usage-stats-user-index',
  description: 'Add collection group index for by_user subcollection',
  createdAt: '2026-01-09',
};

export const fieldOverrides = [
  {
    collectionGroup: 'by_user',
    fieldPath: 'userId',
    indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }],
  },
];

export async function up(context) {
  console.log('  Deploying Firestore collection group index for by_user...');
  await context.deployIndexes();
}
