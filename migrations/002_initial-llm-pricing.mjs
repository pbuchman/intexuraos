/**
 * Migration 002: Initial LLM Pricing
 *
 * Sets pricing data for all LLM models in app_settings/llm_pricing.
 * Prices verified from official sources as of January 2026.
 *
 * Pricing is per million tokens.
 */

export const metadata = {
  id: '002',
  name: 'initial-llm-pricing',
  description: 'Set initial LLM pricing for all providers',
  createdAt: '2026-01-02',
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
  console.log('  Setting LLM pricing for all models...');

  const pricingDoc = {
    models: {
      // Google Gemini - https://ai.google.dev/gemini-api/docs/pricing
      'google_gemini-2.5-pro': createPricingEntry('google', 'gemini-2.5-pro', 1.25, 10.0),
      'google_gemini-2.5-flash': createPricingEntry('google', 'gemini-2.5-flash', 0.3, 2.5),
      'google_gemini-2.5-flash-lite': createPricingEntry('google', 'gemini-2.5-flash-lite', 0.1, 0.4),

      // Anthropic Claude - https://www.anthropic.com/pricing
      'anthropic_claude-opus-4-5-20251101': createPricingEntry('anthropic', 'claude-opus-4-5-20251101', 5.0, 25.0),
      'anthropic_claude-sonnet-4-5-20250929': createPricingEntry('anthropic', 'claude-sonnet-4-5-20250929', 3.0, 15.0),
      'anthropic_claude-haiku-4-5-20251001': createPricingEntry('anthropic', 'claude-haiku-4-5-20251001', 1.0, 5.0),

      // OpenAI - https://openai.com/api/pricing
      'openai_o4-mini-deep-research': createPricingEntry('openai', 'o4-mini-deep-research', 1.1, 4.4),
      'openai_gpt-5.2': createPricingEntry('openai', 'gpt-5.2', 2.5, 10.0),
      'openai_gpt-5-nano': createPricingEntry('openai', 'gpt-5-nano', 0.15, 0.6),
    },
    updatedAt: new Date().toISOString(),
  };

  await context.firestore.doc('app_settings/llm_pricing').set(pricingDoc);

  console.log(`  LLM pricing configured for ${Object.keys(pricingDoc.models).length} models`);
}
