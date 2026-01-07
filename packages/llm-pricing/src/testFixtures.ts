/**
 * Test fixtures for pricing.
 * Provides mock pricing and PricingContext for tests.
 */

import type { ModelPricing, LLMModel } from '@intexuraos/llm-contract';
import type { IPricingContext } from './pricingClient.js';

/**
 * Default test pricing for all models.
 */
export const TEST_PRICING: ModelPricing = {
  inputPricePerMillion: 1.0,
  outputPricePerMillion: 2.0,
};

/**
 * Test image pricing.
 */
export const TEST_IMAGE_PRICING: ModelPricing = {
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
  imagePricing: {
    '1024x1024': 0.04,
    '1536x1024': 0.08,
    '1024x1536': 0.08,
  },
};

/**
 * Fake PricingContext for tests.
 */
export class FakePricingContext implements IPricingContext {
  readonly testPricing: ModelPricing;
  readonly testImagePricing: ModelPricing;

  constructor(pricing: ModelPricing = TEST_PRICING, imagePricing: ModelPricing = TEST_IMAGE_PRICING) {
    this.testPricing = pricing;
    this.testImagePricing = imagePricing;
  }

  getPricing(model: LLMModel): ModelPricing {
    // Return image pricing for image models
    if (model === 'gpt-image-1' || model === 'gemini-2.5-flash-image') {
      return this.testImagePricing;
    }
    return this.testPricing;
  }

  hasPricing(_model: LLMModel): boolean {
    return true;
  }

  validateModels(_models: LLMModel[]): void {
    // Always passes in tests
  }

  validateAllModels(): void {
    // Always passes in tests
  }

  getModelsWithPricing(): LLMModel[] {
    return [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.5-flash-image',
      'o4-mini-deep-research',
      'gpt-5.2',
      'gpt-4o-mini',
      'gpt-image-1',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-3-5-haiku-20241022',
      'sonar',
      'sonar-pro',
      'sonar-deep-research',
    ];
  }
}

/**
 * Create a fake PricingContext for tests.
 */
export function createFakePricingContext(
  pricing: ModelPricing = TEST_PRICING,
  imagePricing: ModelPricing = TEST_IMAGE_PRICING
): FakePricingContext {
  return new FakePricingContext(pricing, imagePricing);
}

