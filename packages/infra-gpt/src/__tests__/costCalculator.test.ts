import { describe, expect, it } from 'vitest';
import { normalizeUsage } from '../costCalculator.js';

describe('infra-gpt costCalculator', () => {
  describe('normalizeUsage', () => {
    it('returns normalized structure with costUsd always 0', () => {
      const result = normalizeUsage(1000, 500, 200, 1, undefined);
      expect(result.costUsd).toBe(0);
      expect(result.cacheTokens).toBe(200);
      expect(result.webSearchCalls).toBe(1);
    });

    it('includes reasoningTokens when provided', () => {
      const result = normalizeUsage(1000, 500, 0, 0, 150);
      expect(result.reasoningTokens).toBe(150);
    });

    it('omits reasoningTokens when zero', () => {
      const result = normalizeUsage(1000, 500, 0, 0, 0);
      expect(result.reasoningTokens).toBeUndefined();
    });

    it('omits optional fields when zero', () => {
      const result = normalizeUsage(1000, 500, 0, 0, undefined);
      expect(result.cacheTokens).toBeUndefined();
      expect(result.webSearchCalls).toBeUndefined();
      expect(result.reasoningTokens).toBeUndefined();
    });
  });
});
