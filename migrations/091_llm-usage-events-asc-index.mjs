/**
 * Migration 091: ASC composite index for llm_usage_events "Oldest first" sort
 *
 * Migrations 086 & 087 declared DESCENDING variants only. The UI supports an
 * "Oldest first" option which issues:
 *   .where('occurredAt', '>=', from).where('occurredAt', '<=', to)
 *   .orderBy('occurredAt', 'asc').orderBy('__name__', 'asc')
 *
 * Firestore composite indexes are direction-specific, so a new ASC index is
 * required — it cannot be served by the existing DESC index.
 *
 * Unfiltered-only: no evidence anyone sorts by "Oldest first + filter" today.
 * Filter-combo ASC variants will be added reactively if a FAILED_PRECONDITION
 * surfaces in production logs.
 */

export const metadata = {
  id: '091',
  name: 'llm-usage-events-asc-index',
  description: 'ASC composite index for llm_usage_events occurredAt oldest-first sort',
  createdAt: '2026-04-11',
};

export const indexes = [
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'occurredAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['llm_usage_events'];

export async function up(context) {
  console.log('  Deploying llm_usage_events oldest-first ASC index (1 index)...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing llm_usage_events ASC index requires manual deletion via Firebase console'
  );
}
