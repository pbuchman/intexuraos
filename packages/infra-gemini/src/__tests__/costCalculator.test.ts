import { describe, expect, it } from 'vitest';
import { calculateTextCost } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('google costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    groundingCostPerRequest: 0.035
  };

  it('calculates basic cost without grounding', () => {
    const usage = { inputTokens: 1000, outputTokens: 500 };
    // (1000*0.1 + 500*0.4)/1M = 300/1M = 0.0003
    expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.0003, 6);
  });

  it('adds grounding cost when enabled', () => {
    const usage = { inputTokens: 1000, outputTokens: 500, groundingEnabled: true };
    // 0.0003 + 0.035 = 0.0353
    expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.0353, 6);
  });
});
