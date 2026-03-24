import { describe, expect, it } from 'vitest';
import { OPENROUTER_ALLOWED_MODELS, isAllowedModel, getAllowlistPricing } from '../allowlist.js';

describe('allowlist', () => {
  describe('OPENROUTER_ALLOWED_MODELS', () => {
    it('has exactly 14 entries', () => {
      expect(OPENROUTER_ALLOWED_MODELS).toHaveLength(14);
    });

    it('contains all expected providers', () => {
      const providers = OPENROUTER_ALLOWED_MODELS.map((m) => m.provider);
      expect(providers).toContain('Qwen');
      expect(providers).toContain('MiniMax');
      expect(providers).toContain('xAI');
      expect(providers).toContain('Moonshot');
      expect(providers).toContain('Anthropic');
      expect(providers).toContain('Google');
      expect(providers).toContain('OpenAI');
      expect(providers).toContain('Xiaomi');
      expect(providers).toContain('Z.ai');
    });

    it('all entries have required fields', () => {
      for (const model of OPENROUTER_ALLOWED_MODELS) {
        expect(model.id).toBeTruthy();
        expect(model.name).toBeTruthy();
        expect(model.provider).toBeTruthy();
        expect(model.promptPerToken).toBeTruthy();
        expect(model.completionPerToken).toBeTruthy();
      }
    });

    it('all model IDs are in provider/model format', () => {
      for (const model of OPENROUTER_ALLOWED_MODELS) {
        expect(model.id).toMatch(/^[a-z0-9-]+\/[a-z0-9._-]+$/);
      }
    });
  });

  describe('isAllowedModel', () => {
    it('returns true for known model IDs', () => {
      expect(isAllowedModel('qwen/qwen3.5-plus-02-15')).toBe(true);
      expect(isAllowedModel('anthropic/claude-sonnet-4.6')).toBe(true);
      expect(isAllowedModel('x-ai/grok-4.1-fast')).toBe(true);
      expect(isAllowedModel('openai/gpt-5.4')).toBe(true);
    });

    it('returns false for unknown model IDs', () => {
      expect(isAllowedModel('unknown/model')).toBe(false);
      expect(isAllowedModel('gemini-2.5-pro')).toBe(false);
      expect(isAllowedModel('')).toBe(false);
    });

    it('returns false for or: prefixed IDs (expecting raw ID)', () => {
      expect(isAllowedModel('or:anthropic/claude-sonnet-4.6')).toBe(false);
    });
  });

  describe('getAllowlistPricing', () => {
    it('returns pricing for known model', () => {
      const pricing = getAllowlistPricing('anthropic/claude-sonnet-4.6');
      expect(pricing).toBeDefined();
      expect(pricing!.useProviderCost).toBe(true);
      // Claude Sonnet 4.6: $3.0/million prompt, $15.0/million completion
      expect(pricing!.inputPricePerMillion).toBeCloseTo(3.0, 2);
      expect(pricing!.outputPricePerMillion).toBeCloseTo(15.0, 2);
    });

    it('returns undefined for unknown model', () => {
      const pricing = getAllowlistPricing('unknown/model');
      expect(pricing).toBeUndefined();
    });

    it('returns valid pricing for all allowlisted models', () => {
      for (const model of OPENROUTER_ALLOWED_MODELS) {
        const pricing = getAllowlistPricing(model.id);
        expect(pricing).toBeDefined();
        expect(pricing!.inputPricePerMillion).toBeGreaterThan(0);
        expect(pricing!.outputPricePerMillion).toBeGreaterThan(0);
        expect(pricing!.useProviderCost).toBe(true);
      }
    });
  });
});
