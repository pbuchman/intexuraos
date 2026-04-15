import { describe, expect, it } from 'vitest';
import { normalizeUsage } from '../costCalculator.js';

describe('infra-perplexity costCalculator', () => {
  describe('normalizeUsage', () => {
    it('normalizes usage with costUsd always 0', () => {
      const result = normalizeUsage(1000, 500, 0.05);
      expect(result.costUsd).toBe(0);
      expect(result.totalTokens).toBe(1500);
    });

    it('always returns webSearchCalls: 1', () => {
      const result = normalizeUsage(1000, 500, undefined);
      expect(result.webSearchCalls).toBe(1);
    });
  });
});
