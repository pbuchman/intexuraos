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

const LLM_PRICING = {
  // Google Gemini - https://ai.google.dev/gemini-api/docs/pricing
  'google_gemini-2.5-pro': {
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
  },
  'google_gemini-2.5-flash': {
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
  },
  'google_gemini-2.5-flash-lite': {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
  },

  // Anthropic Claude - https://www.anthropic.com/pricing
  'anthropic_claude-opus-4-5-20251101': {
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 25.0,
  },
  'anthropic_claude-sonnet-4-5-20250929': {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
  },
  'anthropic_claude-haiku-4-5-20251001': {
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 5.0,
  },

  // OpenAI - https://openai.com/api/pricing
  'openai_o4-mini-deep-research': {
    inputPricePerMillion: 1.1,
    outputPricePerMillion: 4.4,
  },
  'openai_gpt-5.2': {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
  },
  'openai_gpt-5-nano': {
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
};

export async function up(context) {
  console.log('  Setting LLM pricing for 9 models...');

  await context.firestore.doc('app_settings/llm_pricing').set(LLM_PRICING);

  console.log('  LLM pricing configured successfully');
}
