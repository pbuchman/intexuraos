/**
 * Migration 081: No-op placeholder retained to preserve history.
 *
 * Originally committed as 079_placeholder-migration.mjs on the assumption
 * that migration ID 079 was free. That assumption was wrong — 079 was
 * already claimed by 079_reset-execution-memory-scores.mjs (merged earlier
 * via commit 79a65ea7e, already applied to Firestore).
 *
 * Two files sharing id 079 broke both scripts/verify-migrations.mjs
 * (sequential-ID check) and scripts/migrate.mjs (checksum check — one
 * stored checksum can't match two distinct files). Deleting the placeholder
 * was declined because the file was already merged to development history;
 * renaming to the next free id 081 is the additive fix.
 *
 * No-op: this migration does nothing. Its only purpose is to keep the
 * commit that introduced it reachable in git history.
 */

export const metadata = {
  id: '081',
  name: 'placeholder-migration',
  description: 'No-op placeholder retained after rename from duplicate id 079',
  createdAt: '2026-04-05',
};

export async function up(context) {
  console.log('  [noop] Placeholder migration 081');
}
