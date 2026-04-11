/**
 * Migration 088: Backfill OpenRouter pricing entry in llm_pricing if absent.
 *
 * Migration 086 skips OpenRouter when it's missing from the old source
 * collection, but llm-usage-service's getAll() requires all 5 providers.
 * This migration writes an informational entry with `useProviderCost: true`
 * on every model placeholder, satisfying the acceptance criterion that
 * OpenRouter pricing entries carry a provider-reported marker.
 *
 * For OpenRouter, cost comes from the provider API response
 * (`cost.pricingSource = 'provider_reported'`) — pricing table entries
 * are informational only. The `useProviderCost` flag signals to consumers
 * that they should rely on provider-reported costs instead of calculating.
 *
 * Idempotent: only writes if the doc does not already exist.
 */

export const metadata = {
  id: '090',
  name: 'backfill_openrouter_pricing',
  description:
    'Write llm_pricing/openrouter with useProviderCost marker if missing after migration 086',
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
    models: {
      _placeholder: {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        useProviderCost: true,
      },
    },
    useProviderCost: true,
    costSource: 'provider_reported',
    updatedAt: new Date().toISOString(),
  });

  console.log('  Created llm_pricing/openrouter with useProviderCost marker');
}
