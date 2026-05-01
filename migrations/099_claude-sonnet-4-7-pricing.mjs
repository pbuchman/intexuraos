/**
 * Migration 099: Add Claude Sonnet 4.7 pricing
 *
 * Adds the `claude-sonnet-4-7` SKU to the Anthropic pricing document so that
 * usage events from the next-generation Sonnet model can be priced server-side
 * by `apps/llm-usage-service` instead of falling through to
 * `pricingSource: 'missing'`.
 *
 * Prices match the Anthropic Sonnet pricing structure used by `claude-sonnet-4-6`:
 *   - input  : $3.00 / Mtok
 *   - output : $15.00 / Mtok
 *   - cache read multiplier  : 0.10  (=> $0.30 / Mtok)
 *   - cache write multiplier : 1.25  (=> $3.75 / Mtok)
 *   - web search             : $0.01 / call (Anthropic bills $10 / 1,000 searches)
 *
 * Writes ONLY to `llm_pricing/anthropic`. The legacy nested path
 * `settings/llm_pricing/providers/*` was deprecated by migration 089.
 */

export const metadata = {
  id: '099',
  name: 'claude-sonnet-4-7-pricing',
  description: 'Add claude-sonnet-4-7 pricing entry to llm_pricing/anthropic',
  createdAt: '2026-05-01',
};

export async function up(context) {
  console.log('  Adding claude-sonnet-4-7 pricing entry...');

  const ref = context.firestore.doc('llm_pricing/anthropic');
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('Migration 099: llm_pricing/anthropic document missing');
  }

  const data = snap.data();
  const newModels = { ...data.models };
  newModels['claude-sonnet-4-7'] = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.01,
  };

  await ref.set({
    ...data,
    models: newModels,
    updatedAt: new Date().toISOString(),
  });

  console.log('  Done. Anthropic models:', Object.keys(newModels).sort().join(', '));
}
