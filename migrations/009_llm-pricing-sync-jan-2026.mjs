/**
 * Migration 009: LLM Pricing Sync (January 2026)
 *
 * Synchronizes Firestore pricing with official rates as of 2026-01-05.
 * This migration aligns database (source of truth) with official provider pricing.
 *
 * Key corrections:
 * - gemini-2.5-flash: $0.50/$3.00 → $0.30/$2.50 (corrected from migration 005)
 * - gpt-5.2: $1.25/$10.00 → $1.75/$14.00 (corrected from migration 007)
 * - Added missing models used in clients (gemini-2.0-flash, gpt-4o-mini, etc.)
 * - Added Claude 3.5 series pricing
 * - Added webSearchCostPerCall where applicable
 *
 * Sources verified 2026-01-05:
 * - https://ai.google.dev/gemini-api/docs/pricing
 * - https://openai.com/api/pricing/
 * - https://platform.claude.com/docs/en/about-claude/pricing
 * - https://docs.perplexity.ai/getting-started/pricing
 */

export const metadata = {
  id: '009',
  name: 'llm-pricing-sync-jan-2026',
  description: 'Sync all LLM pricing with official rates (January 2026)',
  createdAt: '2026-01-05',
};

function createPricingEntry(provider, model, inputPrice, outputPrice, extras = {}) {
  return {
    provider,
    model,
    inputPricePerMillion: inputPrice,
    outputPricePerMillion: outputPrice,
    ...extras,
  };
}

function createImagePricingEntry(provider, model, pricePerImage) {
  return {
    provider,
    model,
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    imagePricePerUnit: pricePerImage,
  };
}

export async function up(context) {
  console.log('  Syncing LLM pricing with official rates (January 2026)...');

  const pricingUpdate = {
    // ============================================
    // GOOGLE GEMINI
    // Source: https://ai.google.dev/gemini-api/docs/pricing
    // ============================================
    'models.google_gemini-2.5-pro': createPricingEntry('google', 'gemini-2.5-pro', 1.25, 10.0, {
      groundingCostPerCall: 0.035,
    }),
    'models.google_gemini-2.5-flash': createPricingEntry('google', 'gemini-2.5-flash', 0.3, 2.5, {
      groundingCostPerCall: 0.035,
    }),
    'models.google_gemini-2.0-flash': createPricingEntry('google', 'gemini-2.0-flash', 0.1, 0.4, {
      groundingCostPerCall: 0.035,
    }),
    'models.google_gemini-2.5-flash-image': createImagePricingEntry(
      'google',
      'gemini-2.5-flash-image',
      0.03
    ),

    // ============================================
    // OPENAI
    // Source: https://openai.com/api/pricing/
    // ============================================
    'models.openai_gpt-5.2': createPricingEntry('openai', 'gpt-5.2', 1.75, 14.0, {
      cacheReadMultiplier: 0.1,
    }),
    'models.openai_o4-mini-deep-research': createPricingEntry(
      'openai',
      'o4-mini-deep-research',
      1.1,
      4.4,
      {
        cacheReadMultiplier: 0.25,
        webSearchCostPerCall: 0.01,
      }
    ),
    'models.openai_gpt-4o': createPricingEntry('openai', 'gpt-4o', 2.5, 10.0, {
      cacheReadMultiplier: 0.5,
    }),
    'models.openai_gpt-4o-mini': createPricingEntry('openai', 'gpt-4o-mini', 0.15, 0.6, {
      cacheReadMultiplier: 0.5,
    }),
    'models.openai_gpt-4.1': createPricingEntry('openai', 'gpt-4.1', 2.0, 8.0, {
      cacheReadMultiplier: 0.25,
    }),
    'models.openai_gpt-4.1-mini': createPricingEntry('openai', 'gpt-4.1-mini', 0.4, 1.6, {
      cacheReadMultiplier: 0.25,
    }),
    'models.openai_gpt-4.1-nano': createPricingEntry('openai', 'gpt-4.1-nano', 0.1, 0.4, {
      cacheReadMultiplier: 0.25,
    }),
    'models.openai_o1': createPricingEntry('openai', 'o1', 15.0, 60.0, {
      cacheReadMultiplier: 0.5,
    }),
    'models.openai_o1-mini': createPricingEntry('openai', 'o1-mini', 1.1, 4.4, {
      cacheReadMultiplier: 0.5,
    }),
    'models.openai_o3-mini': createPricingEntry('openai', 'o3-mini', 1.1, 4.4, {
      cacheReadMultiplier: 0.5,
    }),
    'models.openai_gpt-image-1': createImagePricingEntry('openai', 'gpt-image-1', 0.04),
    'models.openai_dall-e-3': createImagePricingEntry('openai', 'dall-e-3', 0.04),

    // ============================================
    // ANTHROPIC CLAUDE
    // Source: https://platform.claude.com/docs/en/about-claude/pricing
    // ============================================
    // Claude 4.5 series (latest)
    'models.anthropic_claude-opus-4-5-20251101': createPricingEntry(
      'anthropic',
      'claude-opus-4-5-20251101',
      5.0,
      25.0,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.03,
      }
    ),
    'models.anthropic_claude-sonnet-4-5-20250929': createPricingEntry(
      'anthropic',
      'claude-sonnet-4-5-20250929',
      3.0,
      15.0,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.03,
      }
    ),
    'models.anthropic_claude-haiku-4-5-20251001': createPricingEntry(
      'anthropic',
      'claude-haiku-4-5-20251001',
      1.0,
      5.0,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
      }
    ),
    // Claude 4 series
    'models.anthropic_claude-sonnet-4-20250514': createPricingEntry(
      'anthropic',
      'claude-sonnet-4-20250514',
      3.0,
      15.0,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.03,
      }
    ),
    'models.anthropic_claude-opus-4-20250514': createPricingEntry(
      'anthropic',
      'claude-opus-4-20250514',
      15.0,
      75.0,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.03,
      }
    ),
    // Claude 3.5 series (for validation tests)
    'models.anthropic_claude-3-5-sonnet-20241022': createPricingEntry(
      'anthropic',
      'claude-3-5-sonnet-20241022',
      3.0,
      15.0,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.03,
      }
    ),
    'models.anthropic_claude-3-5-haiku-20241022': createPricingEntry(
      'anthropic',
      'claude-3-5-haiku-20241022',
      0.8,
      4.0,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
      }
    ),
    // Claude 3 series (legacy)
    'models.anthropic_claude-3-opus-20240229': createPricingEntry(
      'anthropic',
      'claude-3-opus-20240229',
      15.0,
      75.0,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
      }
    ),
    'models.anthropic_claude-3-sonnet-20240229': createPricingEntry(
      'anthropic',
      'claude-3-sonnet-20240229',
      3.0,
      15.0,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
      }
    ),
    'models.anthropic_claude-3-haiku-20240307': createPricingEntry(
      'anthropic',
      'claude-3-haiku-20240307',
      0.25,
      1.25,
      {
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
      }
    ),

    // ============================================
    // PERPLEXITY
    // Source: https://docs.perplexity.ai/getting-started/pricing
    // ============================================
    'models.perplexity_sonar': createPricingEntry('perplexity', 'sonar', 1.0, 1.0),
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

  const modelCount = Object.keys(pricingUpdate).filter((k) => k.startsWith('models.')).length;
  console.log(`  LLM pricing synced for ${modelCount} models`);
}
