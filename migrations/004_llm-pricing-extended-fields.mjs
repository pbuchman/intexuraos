/**
 * Migration 004: LLM Pricing Extended Fields
 *
 * Adds additional pricing fields to support accurate cost calculation:
 * - webSearchCostPerCall: Cost per web search/tool call (Claude, OpenAI)
 * - groundingCostPerRequest: Cost per grounding request (Gemini)
 * - cacheWriteMultiplier: Cache creation token multiplier (Anthropic)
 * - cacheReadMultiplier: Cache read token multiplier (Anthropic, OpenAI)
 *
 * Prices verified from official sources as of January 2026.
 */

export const metadata = {
  id: '004',
  name: 'llm-pricing-extended-fields',
  description: 'Add web search, grounding, and cache pricing fields',
  createdAt: '2026-01-04',
};

export async function up(context) {
  console.log('  Adding extended pricing fields...');

  const pricingUpdate = {
    'models.anthropic_claude-opus-4-5-20251101.webSearchCostPerCall': 0.01,
    'models.anthropic_claude-opus-4-5-20251101.cacheWriteMultiplier': 1.25,
    'models.anthropic_claude-opus-4-5-20251101.cacheReadMultiplier': 0.1,

    'models.anthropic_claude-sonnet-4-5-20250929.webSearchCostPerCall': 0.01,
    'models.anthropic_claude-sonnet-4-5-20250929.cacheWriteMultiplier': 1.25,
    'models.anthropic_claude-sonnet-4-5-20250929.cacheReadMultiplier': 0.1,

    'models.anthropic_claude-haiku-4-5-20251001.webSearchCostPerCall': 0.01,
    'models.anthropic_claude-haiku-4-5-20251001.cacheWriteMultiplier': 1.25,
    'models.anthropic_claude-haiku-4-5-20251001.cacheReadMultiplier': 0.1,

    'models.openai_o4-mini-deep-research.webSearchCostPerCall': 0.01,
    'models.openai_o4-mini-deep-research.cacheReadMultiplier': 0.25,

    'models.openai_gpt-5.2.webSearchCostPerCall': 0.01,
    'models.openai_gpt-5.2.cacheReadMultiplier': 0.25,

    'models.openai_gpt-5-nano.webSearchCostPerCall': 0.01,
    'models.openai_gpt-5-nano.cacheReadMultiplier': 0.25,

    'models.google_gemini-2.5-pro.groundingCostPerRequest': 0.035,
    'models.google_gemini-2.5-flash.groundingCostPerRequest': 0.035,
    'models.google_gemini-2.5-flash-lite.groundingCostPerRequest': 0.035,

    updatedAt: new Date().toISOString(),
  };

  await context.firestore.doc('app_settings/llm_pricing').update(pricingUpdate);

  console.log('  Extended pricing fields added for all models');
}
