import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENROUTER_ALLOWED_MODELS,
  isDefaultAllowedModel,
  getDefaultAllowlistPricing,
  type DefaultAllowedOpenRouterModel,
} from '../defaultAllowlist.js';

describe('defaultAllowlist', () => {
  describe('DEFAULT_OPENROUTER_ALLOWED_MODELS', () => {
    it('has exactly 4 entries', () => {
      expect(DEFAULT_OPENROUTER_ALLOWED_MODELS).toHaveLength(4);
    });

    it('all entries have required fields', () => {
      for (const model of DEFAULT_OPENROUTER_ALLOWED_MODELS) {
        expect(model.id).not.toBe('');
        expect(model.name).not.toBe('');
        expect(model.provider).not.toBe('');
        expect(model.promptPerToken).not.toBe('');
        expect(model.completionPerToken).not.toBe('');
      }
    });

    it('contains expected model IDs', () => {
      const ids = DEFAULT_OPENROUTER_ALLOWED_MODELS.map((m) => m.id);
      expect(ids).toContain('google/gemma-4-31b-it:free');
      expect(ids).toContain('minimax/minimax-m2.7');
      expect(ids).toContain('qwen/qwen3.6-plus');
      expect(ids).toContain('nvidia/nemotron-3-super-120b-a12b:free');
    });

    it('type satisfies DefaultAllowedOpenRouterModel interface', () => {
      const first = DEFAULT_OPENROUTER_ALLOWED_MODELS[0];
      if (first === undefined) throw new Error('Test setup: no models in default allowlist');
      const model: DefaultAllowedOpenRouterModel = first;
      expect(model.id).toBeDefined();
    });
  });

  describe('isDefaultAllowedModel', () => {
    it('returns true for allowed model IDs', () => {
      expect(isDefaultAllowedModel('google/gemma-4-31b-it:free')).toBe(true);
      expect(isDefaultAllowedModel('minimax/minimax-m2.7')).toBe(true);
      expect(isDefaultAllowedModel('qwen/qwen3.6-plus')).toBe(true);
      expect(isDefaultAllowedModel('nvidia/nemotron-3-super-120b-a12b:free')).toBe(true);
    });

    it('returns false for non-allowed model IDs', () => {
      expect(isDefaultAllowedModel('unknown/model')).toBe(false);
      expect(isDefaultAllowedModel('')).toBe(false);
      expect(isDefaultAllowedModel('qwen/qwen3.5-plus-02-15')).toBe(false);
    });
  });

  describe('getDefaultAllowlistPricing', () => {
    it('returns pricing for allowed models with non-negative prices', () => {
      for (const model of DEFAULT_OPENROUTER_ALLOWED_MODELS) {
        const pricing = getDefaultAllowlistPricing(model.id);
        expect(pricing).not.toBeUndefined();
        if (pricing === undefined) return;
        expect(pricing.inputPricePerMillion).toBeGreaterThanOrEqual(0);
        expect(pricing.outputPricePerMillion).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns correct pricing for paid model (minimax/minimax-m2.7)', () => {
      const pricing = getDefaultAllowlistPricing('minimax/minimax-m2.7');
      expect(pricing).not.toBeUndefined();
      if (pricing === undefined) return;
      // 0.0000003 per token * 1_000_000 = 0.3
      expect(pricing.inputPricePerMillion).toBeCloseTo(0.3, 5);
      // 0.0000012 per token * 1_000_000 = 1.2
      expect(pricing.outputPricePerMillion).toBeCloseTo(1.2, 5);
      expect(pricing.useProviderCost).toBe(true);
    });

    it('returns zero pricing for free models', () => {
      const pricing = getDefaultAllowlistPricing('google/gemma-4-31b-it:free');
      expect(pricing).not.toBeUndefined();
      if (pricing === undefined) return;
      expect(pricing.inputPricePerMillion).toBe(0);
      expect(pricing.outputPricePerMillion).toBe(0);
    });

    it('returns undefined for non-allowed models', () => {
      expect(getDefaultAllowlistPricing('unknown/model')).toBeUndefined();
      expect(getDefaultAllowlistPricing('')).toBeUndefined();
      expect(getDefaultAllowlistPricing('qwen/qwen3.5-plus-02-15')).toBeUndefined();
    });
  });
});
