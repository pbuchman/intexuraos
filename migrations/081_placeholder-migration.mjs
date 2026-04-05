/**
 * Migration 081: Placeholder to maintain sequential migration IDs
 *
 * Originally 079_placeholder-migration.mjs on development. Renumbered to 081
 * because the real migration 079_reset-execution-memory-scores.mjs now occupies
 * ID 079, and 080 is already taken. This fills the gap at 081.
 *
 * No-op: this migration does nothing.
 */

export const metadata = {
  id: '081',
  name: 'placeholder-migration',
  description: 'Placeholder to fill migration ID gap at 081',
  createdAt: '2026-04-05',
};

export async function up(context) {
  console.log('  [noop] Placeholder migration 081');
}
