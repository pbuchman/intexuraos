import { describe, expect, it } from 'vitest';
import { normalizeUsage } from '../costCalculator.js';

describe('infra-gemini costCalculator', () => {
  describe('normalizeUsage', () => {
    it('returns normalized usage with costUsd always 0', () => {
      const result = normalizeUsage(1000, 500, true);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: 0,
        groundingEnabled: true,
      });
    });

    it('omits groundingEnabled when false', () => {
      const result = normalizeUsage(1000, 500, false);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: 0,
      });
      expect(result.groundingEnabled).toBeUndefined();
    });

    it('includes thinkingTokens when provided and non-zero', () => {
      const result = normalizeUsage(1000, 500, false, 300);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: 0,
        thinkingTokens: 300,
      });
    });

    it('omits thinkingTokens from result when zero', () => {
      const result = normalizeUsage(1000, 500, false, 0);
      expect(result.thinkingTokens).toBeUndefined();
      expect(result.costUsd).toBe(0);
    });

    it('omits thinkingTokens from result when undefined', () => {
      const result = normalizeUsage(1000, 500, false);
      expect(result.thinkingTokens).toBeUndefined();
    });
  });
});
