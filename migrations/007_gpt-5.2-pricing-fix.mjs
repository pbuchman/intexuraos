/**
 * Migration 007: GPT-5.2 Pricing Fix
 *
 * Aligns gpt-5.2 pricing with OpenAI's current published rates.
 *
 * Changes:
 * - gpt-5.2: input $1.75 → $1.25, output $14.00 → $10.00
 *
 * Source: https://openai.com/api/pricing (verified 2026-01-04)
 */

export const metadata = {
  id: '007',
  name: 'gpt-5.2-pricing-fix',
  description: 'Align gpt-5.2 pricing with OpenAI published rates',
  createdAt: '2026-01-04',
};

export async function up(context) {
  console.log('  Fixing gpt-5.2 pricing...');

  const pricingUpdate = {
    'models.openai_gpt-5.2.inputPricePerMillion': 1.25,
    'models.openai_gpt-5.2.outputPricePerMillion': 10.0,
    updatedAt: new Date().toISOString(),
  };

  await context.firestore.doc('app_settings/llm_pricing').update(pricingUpdate);

  console.log('  gpt-5.2 pricing updated: $1.75/$14 → $1.25/$10');
}
