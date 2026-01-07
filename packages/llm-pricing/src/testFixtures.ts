/**
 * Test fixtures for pricing.
 * Provides mock pricing and PricingContext for tests.
 */

import { LlmModels, type ModelPricing, type LLMModel } from '@intexuraos/llm-contract';
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
    if (model === LlmModels.GPTImage1 || model === LlmModels.Gemini25FlashImage) {
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
      LlmModels.Gemini25Pro,
      LlmModels.Gemini25Flash,
      LlmModels.Gemini20Flash,
      LlmModels.Gemini25FlashImage,
      LlmModels.O4MiniDeepResearch,
      LlmModels.GPT52,
      LlmModels.GPT4oMini,
      LlmModels.GPTImage1,
      LlmModels.ClaudeOpus45,
      LlmModels.ClaudeSonnet45,
      LlmModels.ClaudeHaiku35,
      LlmModels.Sonar,
      LlmModels.SonarPro,
      LlmModels.SonarDeepResearch,
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

