/**
 * Migration 088: Backfill OpenRouter placeholder in llm_pricing if absent.
 *
 * Migration 086 skips OpenRouter when it's missing from the old source
 * collection, but llm-usage-service's getAll() requires all 5 providers.
 * This migration writes a minimal placeholder doc so getAll() won't 500
 * if OpenRouter was absent in the source.
 *
 * Idempotent: only writes if the doc does not already exist.
 */

export const metadata = {
  id: '088',
  name: 'backfill_openrouter_pricing_placeholder',
  description: 'Write placeholder llm_pricing/openrouter if missing after migration 086',
  createdAt: '2026-04-10',
};

export async function up(context) {
  const docRef = context.firestore.doc('llm_pricing/openrouter');
  const snap = await docRef.get();

  if (snap.exists) {
    console.log('  llm_pricing/openrouter already exists — skipping');
    return;
  }

  await docRef.set({
    provider: 'openrouter',
    models: {},
    updatedAt: new Date().toISOString(),
  });

  console.log('  Created placeholder llm_pricing/openrouter');
}
