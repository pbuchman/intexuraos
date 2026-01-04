/**
 * Migration 005: LLM Pricing Update (January 2026)
 *
 * Updates pricing based on official sources as of 2026-01-04.
 *
 * Changes:
 * - gemini-2.5-pro: input $1.25 → $2.00, output $10.00 → $12.00
 * - gemini-2.5-flash: input $0.30 → $0.50, output $2.50 → $3.00
 * - gpt-5.2: input $2.50 → $1.75, output $10.00 → $14.00
 * - Added: sonar (basic) with $1/$1 pricing
 *
 * Sources:
 * - https://ai.google.dev/gemini-api/docs/pricing
 * - https://openai.com/api/pricing
 * - https://docs.perplexity.ai/getting-started/pricing
 */

export const metadata = {
  id: '005',
  name: 'llm-pricing-update-jan-2026',
  description: 'Update LLM pricing from official sources',
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
  console.log('  Updating LLM pricing...');

  const pricingUpdate = {
    // Google Gemini price increases
    'models.google_gemini-2.5-pro.inputPricePerMillion': 2.0,
    'models.google_gemini-2.5-pro.outputPricePerMillion': 12.0,

    'models.google_gemini-2.5-flash.inputPricePerMillion': 0.5,
    'models.google_gemini-2.5-flash.outputPricePerMillion': 3.0,

    // OpenAI gpt-5.2 price changes (input down, output up)
    'models.openai_gpt-5.2.inputPricePerMillion': 1.75,
    'models.openai_gpt-5.2.outputPricePerMillion': 14.0,

    // New model: Perplexity sonar (basic)
    'models.perplexity_sonar': createPricingEntry('perplexity', 'sonar', 1.0, 1.0),

    updatedAt: new Date().toISOString(),
  };

  await context.firestore.doc('app_settings/llm_pricing').update(pricingUpdate);

  console.log('  LLM pricing updated for 4 models');
}
