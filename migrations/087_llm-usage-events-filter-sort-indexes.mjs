/**
 * Migration 087: Composite indexes for llm_usage_events filter + alternate sort
 *
 * Migration 086 only covers unfiltered alternate sorts (occurredAt + costUsd/totalTokens).
 * This adds indexes for single-filter + alternate-sort combinations so that
 * Firestore can serve `where(filterField, 'in', [...]) + orderBy(altSort)` queries
 * natively with accurate `.count()` pagination.
 *
 * 5 filter fields x 2 alt sort fields = 10 indexes
 *
 * INT-1340: LLM usage events list API
 */

export const metadata = {
  id: '087',
  name: 'llm-usage-events-filter-sort-indexes',
  description:
    'Composite indexes for filter + alternate sort combinations (filter x costUsd/totalTokens)',
  createdAt: '2026-04-10',
};

const FILTER_FIELDS = [
  'source.service',
  'source.component',
  'request.provider',
  'request.model',
  'owner.id',
];

const ALT_SORT_FIELDS = ['cost.billedUsd', 'usage.totalTokens'];

export const indexes = FILTER_FIELDS.flatMap((filterField) =>
  ALT_SORT_FIELDS.map((sortField) => ({
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: filterField, order: 'ASCENDING' },
      { fieldPath: sortField, order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  }))
);

export const collections = ['llm_usage_events'];

export async function up(context) {
  console.log('  Deploying llm_usage_events filter+sort composite indexes (10 indexes)...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing llm_usage_events filter+sort indexes requires manual deletion via Firebase console'
  );
}
