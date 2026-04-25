/**
 * Migration 098: Cleanup orphaned indexes + registry reconcile (INT-1532-S2)
 *
 * Removes Firestore composite indexes and field overrides for collection
 * groups that no longer have any code references in apps/, workers/, or
 * packages/. The aggregator in scripts/migrate.mjs honors
 * `removedCollectionGroups` and filters them out of the aggregated
 * firestore.indexes.json artifact.
 *
 * Confirmed orphans (verified via grep against apps/, workers/, packages/):
 *   - compositeFeeds (camelCase historical alias)
 *   - composite_feeds (snake_case)
 *   - composite_feed_snapshots
 *   - custom_data_sources
 *   - dataSource
 *   - visualizations
 *   - by_user (fieldOverride for the deleted llm_usage_stats subcollection)
 *
 * NOT orphaned (kept; aliased in firestore-collections.json):
 *   - writing_samples — subcollection of hellscript_writing_config; declared via
 *     `indexCollectionGroups` on the parent registry row.
 *
 * Live Firestore indexes for these collection groups must still be deleted
 * out-of-band — see migrations/098_cleanup-orphaned-indexes-and-registry.runbook.md.
 */

export const metadata = {
  id: '098',
  name: 'cleanup-orphaned-indexes-and-registry',
  description: 'Drop orphaned composite indexes + by_user field override',
  createdAt: '2026-04-25',
};

export const indexes = [];

export const removedCollectionGroups = [
  'compositeFeeds',
  'composite_feeds',
  'composite_feed_snapshots',
  'custom_data_sources',
  'dataSource',
  'visualizations',
  'by_user',
];

export async function up(context) {
  console.log('  Cleanup migration 098: deploying regenerated indexes');
  await context.deployIndexes();
}
