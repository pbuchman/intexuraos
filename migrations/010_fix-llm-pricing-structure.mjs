/**
 * Migration 010: Fix LLM Pricing Structure
 *
 * Fixes the nested object issue caused by dots in model names.
 * Completely replaces the llm_pricing document with clean structure.
 *
 * Only includes the 14 models actually used in the codebase:
 * - Research models: from packages/llm-contract/src/supportedModels.ts
 * - Image models: from apps/image-service/src/domain/models/ImageGenerationModel.ts
 * - Validation models: from apps/user-service/src/infra/llm/LlmValidatorImpl.ts
 */

export const metadata = {
  id: '010',
  name: 'fix-llm-pricing-structure',
  description: 'Fix nested object structure - clean pricing for 14 used models',
  createdAt: '2026-01-05',
};

export async function up(context) {
  console.log('  Fixing LLM pricing structure with 14 models actually used in code...');

  const models = {
    // ========================================
    // GOOGLE (4 models)
    // ========================================
    // Research (supportedModels.ts)
    'google_gemini-2.5-pro': {
      provider: 'google',
      model: 'gemini-2.5-pro',
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 10.0,
      groundingCostPerCall: 0.035,
    },
    'google_gemini-2.5-flash': {
      provider: 'google',
      model: 'gemini-2.5-flash',
      inputPricePerMillion: 0.3,
      outputPricePerMillion: 2.5,
      groundingCostPerCall: 0.035,
    },
    // Key validation (LlmValidatorImpl.ts)
    'google_gemini-2.0-flash': {
      provider: 'google',
      model: 'gemini-2.0-flash',
      inputPricePerMillion: 0.1,
      outputPricePerMillion: 0.4,
      groundingCostPerCall: 0.035,
    },
    // Image generation (ImageGenerationModel.ts)
    'google_gemini-2.5-flash-image': {
      provider: 'google',
      model: 'gemini-2.5-flash-image',
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      imagePricePerUnit: 0.03,
    },

    // ========================================
    // OPENAI (4 models)
    // ========================================
    // Research (supportedModels.ts)
    'openai_o4-mini-deep-research': {
      provider: 'openai',
      model: 'o4-mini-deep-research',
      inputPricePerMillion: 1.1,
      outputPricePerMillion: 4.4,
      cacheReadMultiplier: 0.25,
      webSearchCostPerCall: 0.01,
    },
    'openai_gpt-5.2': {
      provider: 'openai',
      model: 'gpt-5.2',
      inputPricePerMillion: 1.75,
      outputPricePerMillion: 14.0,
      cacheReadMultiplier: 0.1,
    },
    // Key validation (LlmValidatorImpl.ts)
    'openai_gpt-4o-mini': {
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.6,
      cacheReadMultiplier: 0.5,
    },
    // Image generation (ImageGenerationModel.ts)
    'openai_gpt-image-1': {
      provider: 'openai',
      model: 'gpt-image-1',
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      imagePricePerUnit: 0.04,
    },

    // ========================================
    // ANTHROPIC (3 models)
    // ========================================
    // Research (supportedModels.ts)
    'anthropic_claude-opus-4-5-20251101': {
      provider: 'anthropic',
      model: 'claude-opus-4-5-20251101',
      inputPricePerMillion: 5.0,
      outputPricePerMillion: 25.0,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      webSearchCostPerCall: 0.03,
    },
    'anthropic_claude-sonnet-4-5-20250929': {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
      webSearchCostPerCall: 0.03,
    },
    // Key validation (LlmValidatorImpl.ts)
    'anthropic_claude-3-5-haiku-20241022': {
      provider: 'anthropic',
      model: 'claude-3-5-haiku-20241022',
      inputPricePerMillion: 0.8,
      outputPricePerMillion: 4.0,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
    },

    // ========================================
    // PERPLEXITY (3 models)
    // ========================================
    // Research (supportedModels.ts)
    perplexity_sonar: {
      provider: 'perplexity',
      model: 'sonar',
      inputPricePerMillion: 1.0,
      outputPricePerMillion: 1.0,
    },
    'perplexity_sonar-pro': {
      provider: 'perplexity',
      model: 'sonar-pro',
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
    },
    'perplexity_sonar-deep-research': {
      provider: 'perplexity',
      model: 'sonar-deep-research',
      inputPricePerMillion: 2.0,
      outputPricePerMillion: 8.0,
    },
  };

  // Use set() to completely replace the document (no dot notation issues)
  await context.firestore.doc('app_settings/llm_pricing').set({
    models,
    updatedAt: new Date().toISOString(),
  });

  console.log(`  Created clean pricing for ${Object.keys(models).length} models`);
}
