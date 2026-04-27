# Migration 098 Runbook — Manual Live Index Deletion

After this migration deploys, the aggregated `firestore.indexes.json` no longer
declares the listed collection groups. Firestore does NOT auto-drop indexes that
are absent from the deployed config — they must be deleted manually.

## Scope

Project: `intexuraos-dev-pbuchman`

## Indexes to delete

For each collection group below, list the live composite indexes via:

    gcloud firestore indexes composite list \
      --project=intexuraos-dev-pbuchman \
      --filter='collectionGroup="<group>"'

Then delete each by name:

    gcloud firestore indexes composite delete <INDEX_NAME> \
      --project=intexuraos-dev-pbuchman

Collection groups whose indexes must be dropped:

- compositeFeeds
- composite_feeds
- composite_feed_snapshots
- custom_data_sources
- dataSource
- visualizations

## Field overrides to delete

`by_user` (collection-group field override on `userId`) — delete via:

    gcloud firestore indexes fields update userId \
      --collection-group=by_user \
      --project=intexuraos-dev-pbuchman \
      --disable-indexes

## Verification

    node scripts/verify-firestore-ownership.mjs

Must report zero `ORPHAN_INDEX` and zero `UNDECLARED` violations after the
cleanup migration runs and the aggregated artifact is regenerated.
