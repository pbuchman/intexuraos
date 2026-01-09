/**
 * Migration 011: New Pricing Structure for app-settings-service
 * Cache-bust: 2026-01-05T14:00:00Z
 *
 * Creates new pricing collection structure: settings/llm_pricing/providers/{provider}
 * Each provider gets its own document with models pricing.
 * This is used by app-settings-service as the new source of truth.
 *
 * Models included (14 total):
 * - Google: gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, gemini-2.5-flash-image
 * - OpenAI: o4-mini-deep-research, gpt-5.2, gpt-4o-mini, gpt-image-1
 * - Anthropic: claude-opus-4-5-20251101, claude-sonnet-4-5-20250929, claude-3-5-haiku-20241022
 * - Perplexity: sonar, sonar-pro, sonar-deep-research
 */

export const metadata = {
  id: '012',
  name: 'new-pricing-structure',
  description:
    'Create new settings/llm_pricing/providers/{provider} structure with per-size image pricing',
  createdAt: '2026-01-05',
};

export async function up(context) {
  console.log('  Creating new pricing structure in settings/llm_pricing/providers/...');

  const timestamp = new Date().toISOString();

  // Google provider
  const googlePricing = {
    provider: 'google',
    models: {
      'gemini-2.5-pro': {
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
        groundingCostPerRequest: 0.035,
      },
      'gemini-2.5-flash': {
        inputPricePerMillion: 0.3,
        outputPricePerMillion: 2.5,
        groundingCostPerRequest: 0.035,
      },
      'gemini-2.0-flash': {
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
        groundingCostPerRequest: 0.035,
      },
      'gemini-2.5-flash-image': {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: {
          '1024x1024': 0.03,
          '1536x1024': 0.04,
          '1024x1536': 0.04,
        },
      },
    },
    updatedAt: timestamp,
  };

  // OpenAI provider
  const openaiPricing = {
    provider: 'openai',
    models: {
      'o4-mini-deep-research': {
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 8.0,
        cacheReadMultiplier: 0.25,
        webSearchCostPerCall: 0.01,
      },
      'gpt-5.2': {
        inputPricePerMillion: 1.75,
        outputPricePerMillion: 14.0,
        cacheReadMultiplier: 0.1,
      },
      'gpt-4o-mini': {
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.6,
        cacheReadMultiplier: 0.5,
      },
      'gpt-image-1': {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: {
          '1024x1024': 0.04,
          '1536x1024': 0.08,
          '1024x1536': 0.08,
        },
      },
    },
    updatedAt: timestamp,
  };

  // Anthropic provider
  const anthropicPricing = {
    provider: 'anthropic',
    models: {
      'claude-opus-4-5-20251101': {
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.03,
      },
      'claude-sonnet-4-5-20250929': {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.03,
      },
      'claude-3-5-haiku-20241022': {
        inputPricePerMillion: 0.8,
        outputPricePerMillion: 4.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
      },
    },
    updatedAt: timestamp,
  };

  // Perplexity provider
  const perplexityPricing = {
    provider: 'perplexity',
    models: {
      sonar: {
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 1.0,
        useProviderCost: true,
      },
      'sonar-pro': {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        useProviderCost: true,
      },
      'sonar-deep-research': {
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 8.0,
        useProviderCost: true,
      },
    },
    updatedAt: timestamp,
  };

  // Create documents
  // Path structure: settings/llm_pricing/providers/{provider}
  // (collection/document/collection/document - must have even number of components)
  const batch = context.firestore.batch();

  batch.set(context.firestore.doc('settings/llm_pricing/providers/google'), googlePricing);
  batch.set(context.firestore.doc('settings/llm_pricing/providers/openai'), openaiPricing);
  batch.set(context.firestore.doc('settings/llm_pricing/providers/anthropic'), anthropicPricing);
  batch.set(context.firestore.doc('settings/llm_pricing/providers/perplexity'), perplexityPricing);

  await batch.commit();

  console.log('  Created pricing documents for 4 providers:');
  console.log(`    - google: ${Object.keys(googlePricing.models).length} models`);
  console.log(`    - openai: ${Object.keys(openaiPricing.models).length} models`);
  console.log(`    - anthropic: ${Object.keys(anthropicPricing.models).length} models`);
  console.log(`    - perplexity: ${Object.keys(perplexityPricing.models).length} models`);
}
