/**
 * Test pricing fixtures for LLM clients.
 *
 * Values match migration 012 structure (with DALL-E 3 removed per migration 013).
 * Use these in tests to avoid hardcoding pricing values.
 */
import type { ModelPricing } from '../../pricing.js';

export const TEST_GOOGLE_PRICING: Record<string, ModelPricing> = {
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
    imagePricing: { '1024x1024': 0.03, '1536x1024': 0.04, '1024x1536': 0.04 },
  },
};

export const TEST_OPENAI_PRICING: Record<string, ModelPricing> = {
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
    imagePricing: { '1024x1024': 0.04, '1536x1024': 0.08, '1024x1536': 0.08 },
  },
};

export const TEST_ANTHROPIC_PRICING: Record<string, ModelPricing> = {
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
};

export const TEST_PERPLEXITY_PRICING: Record<string, ModelPricing> = {
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
};

export const TEST_ZAI_PRICING: Record<string, ModelPricing> = {
  'glm-4.7': {
    inputPricePerMillion: 0.6,
    outputPricePerMillion: 2.2,
    webSearchCostPerCall: 0.005,
  },
  'glm-4.7-flash': {
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    webSearchCostPerCall: 0,
  },
};

/** Helper to get pricing for a specific model */
export function getTestPricing(
  provider: 'google' | 'openai' | 'anthropic' | 'perplexity' | 'zai',
  model: string
): ModelPricing {
  const pricingMap = {
    google: TEST_GOOGLE_PRICING,
    openai: TEST_OPENAI_PRICING,
    anthropic: TEST_ANTHROPIC_PRICING,
    perplexity: TEST_PERPLEXITY_PRICING,
    zai: TEST_ZAI_PRICING,
  };
  const pricing = pricingMap[provider][model];
  if (pricing === undefined) {
    throw new Error(`No test pricing for ${provider}/${model}`);
  }
  return pricing;
}
