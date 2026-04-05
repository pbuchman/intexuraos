/**
 * Migration 079: No-op placeholder to fill sequential gap.
 *
 * The original 079_placeholder-migration.mjs was renamed to 081 due to a
 * duplicate-ID conflict with 079_reset-execution-memory-scores.mjs which was
 * itself later renamed to 081_reset-execution-memory-scores.mjs.
 *
 * This leaves a gap at ID 079 that breaks the sequential-ID verification.
 * This no-op migration fills the gap.
 */

export const metadata = {
  id: '079',
  name: 'placeholder-gap-fill',
  description: 'No-op placeholder to fill sequential ID gap at 079',
  createdAt: '2026-04-05',
};

export async function up(context) {
  console.log('  [noop] Placeholder migration 079 (gap fill)');
}
