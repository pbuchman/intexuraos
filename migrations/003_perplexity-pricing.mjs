/**
 * Migration 003: Perplexity Pricing
 *
 * Adds pricing data for Perplexity Sonar models to app_settings/llm_pricing.
 * Prices verified from https://docs.perplexity.ai/guides/pricing as of January 2026.
 *
 * Pricing notes:
 * - sonar-pro: $3/M input, $15/M output, $0.006 per request
 * - sonar-deep-research: $2/M input, $8/M output (includes search costs)
 */

export const metadata = {
  id: '003',
  name: 'perplexity-pricing',
  description: 'Add Perplexity Sonar pricing for research models',
  createdAt: '2026-01-04',
};

function createPricingEntry(provider, model, inputPrice, outputPrice) {
  return {
    provider,
    model,
    inputPricePerMillion: inputPrice,
    outputPricePerMillion: outputPrice,
  };
}

export async function up(context) {
  console.log('  Adding Perplexity pricing...');

  const pricingUpdate = {
    'models.perplexity_sonar-pro': createPricingEntry('perplexity', 'sonar-pro', 3.0, 15.0),
    'models.perplexity_sonar-deep-research': createPricingEntry(
      'perplexity',
      'sonar-deep-research',
      2.0,
      8.0
    ),
    updatedAt: new Date().toISOString(),
  };

  await context.firestore.doc('app_settings/llm_pricing').update(pricingUpdate);

  console.log('  Perplexity pricing added for 2 models');
}
