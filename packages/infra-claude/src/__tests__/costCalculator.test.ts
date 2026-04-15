import { describe, expect, it } from 'vitest';
import { normalizeUsage } from '../costCalculator.js';

describe('infra-claude costCalculator', () => {
  describe('normalizeUsage', () => {
    it('aggregates cache tokens into single contract field', () => {
      // 2000 Read + 500 Write
      const result = normalizeUsage(1000, 100, 2000, 500, 1);

      // Contract compliance:
      expect(result.cacheTokens).toBe(2500); // 2000 + 500
      expect(result.costUsd).toBe(0);
      expect(result.webSearchCalls).toBe(1);
    });

    it('omits cacheTokens when zero', () => {
      const result = normalizeUsage(1000, 100, 0, 0, 0);
      expect(result.cacheTokens).toBeUndefined();
    });

    it('omits webSearchCalls when zero', () => {
      const result = normalizeUsage(1000, 100, 0, 0, 0);
      expect(result.webSearchCalls).toBeUndefined();
    });

    it('returns correct totalTokens including cache', () => {
      const result = normalizeUsage(1000, 100, 200, 300, 0);
      expect(result.totalTokens).toBe(1000 + 100 + 500); // input + output + cache
    });
  });
});
