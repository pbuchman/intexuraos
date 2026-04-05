/**
 * Migration 082: No-op placeholder retained to preserve history.
 *
 * Originally committed as 079_placeholder-migration.mjs, then renamed to
 * 081_placeholder-migration.mjs. Both IDs conflicted with real migrations.
 * Renamed to 082 as the next free sequential ID.
 *
 * No-op: this migration does nothing. Its only purpose is to keep the
 * commit that introduced it reachable in git history.
 */

export const metadata = {
  id: '082',
  name: 'placeholder-migration',
  description: 'No-op placeholder retained after rename from duplicate id 081',
  createdAt: '2026-04-05',
};

export async function up(context) {
  console.log('  [noop] Placeholder migration 082');
}
