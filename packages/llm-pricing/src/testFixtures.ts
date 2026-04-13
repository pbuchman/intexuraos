/**
 * Test fixtures for pricing.
 * Provides mock pricing, PricingContext, and UsageSink for tests.
 */

import { LlmModels, type ModelPricing, type LLMModel } from '@intexuraos/llm-contract';
import type { IPricingContext } from './pricingClient.js';
import type { UsageLogParams, UsageSink } from './usageLogger.js';

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

  constructor(
    pricing: ModelPricing = TEST_PRICING,
    imagePricing: ModelPricing = TEST_IMAGE_PRICING
  ) {
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

/**
 * Snapshot of a usage event captured by {@link FakeUsageSink}.
 */
export type FakeUsageSinkRecord = UsageLogParams;

/**
 * In-memory UsageSink for tests. Captures every log call in a mutable array
 * so tests can assert usage tracking behavior without real HTTP traffic.
 *
 * @example
 * ```ts
 * const sink = new FakeUsageSink();
 * const client = createGeminiClient({ ..., usageSink: sink });
 * await client.generate('hello');
 * expect(sink.records).toHaveLength(1);
 * expect(sink.records[0].callType).toBe('generate');
 * ```
 */
export class FakeUsageSink implements UsageSink {
  readonly records: FakeUsageSinkRecord[] = [];

  log(params: UsageLogParams): Promise<void> {
    this.records.push(params);
    return Promise.resolve();
  }

  /** Clear captured records between test cases. */
  clear(): void {
    this.records.length = 0;
  }
}

/**
 * Create a {@link FakeUsageSink} instance. Convenience helper for tests that
 * prefer a factory function over `new`.
 */
export function createFakeUsageSink(): FakeUsageSink {
  return new FakeUsageSink();
}
