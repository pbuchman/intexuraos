import { describe, expect, it } from 'vitest';
import {
  OPENROUTER_ALLOWED_MODELS,
  OPENROUTER_VALIDATION_MODEL,
  isAllowedModel,
  getAllowlistPricing,
  allowlistModelIds,
  buildModelInfo,
  type CatalogEntry,
} from '../allowlist.js';
import { LlmModels } from '@intexuraos/llm-contract';

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

    it('all entries have required fields including contextLength', () => {
      for (const model of OPENROUTER_ALLOWED_MODELS) {
        expect(model.id).not.toBe('');
        expect(model.name).not.toBe('');
        expect(model.provider).not.toBe('');
        expect(model.contextLength).toBeGreaterThan(0);
        expect(model.promptPerToken).not.toBe('');
        expect(model.completionPerToken).not.toBe('');
      }
    });

    it('context lengths match documented values from Linear issue', () => {
      const byId = (id: string): (typeof OPENROUTER_ALLOWED_MODELS)[number] | undefined =>
        OPENROUTER_ALLOWED_MODELS.find((m) => m.id === id);
      // xAI models: 2M context
      expect(byId('x-ai/grok-4.20-beta')?.contextLength).toBe(2_000_000);
      expect(byId('x-ai/grok-4.1-fast')?.contextLength).toBe(2_000_000);
      // MiniMax: 205K
      expect(byId('minimax/minimax-m2.7')?.contextLength).toBe(205_000);
      // Z.ai: 203K
      expect(byId('z-ai/glm-5-turbo')?.contextLength).toBe(203_000);
      // Moonshot: 262K
      expect(byId('moonshotai/kimi-k2.5')?.contextLength).toBe(262_000);
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
      expect(isAllowedModel(LlmModels.Gemini25Pro)).toBe(false);
      expect(isAllowedModel('')).toBe(false);
    });

    it('returns false for or: prefixed IDs (expecting raw ID)', () => {
      expect(isAllowedModel('or:anthropic/claude-sonnet-4.6')).toBe(false);
    });
  });

  describe('getAllowlistPricing', () => {
    it('returns pricing for known model', () => {
      const pricing = getAllowlistPricing('anthropic/claude-sonnet-4.6');
      expect(pricing).not.toBeUndefined();
      if (pricing === undefined) return;
      expect(pricing.useProviderCost).toBe(true);
      // Claude Sonnet 4.6: $3.0/million prompt, $15.0/million completion
      expect(pricing.inputPricePerMillion).toBeCloseTo(3.0, 2);
      expect(pricing.outputPricePerMillion).toBeCloseTo(15.0, 2);
    });

    it('returns undefined for unknown model', () => {
      const pricing = getAllowlistPricing('unknown/model');
      expect(pricing).toBeUndefined();
    });

    it('returns valid pricing for all allowlisted models', () => {
      for (const model of OPENROUTER_ALLOWED_MODELS) {
        const pricing = getAllowlistPricing(model.id);
        expect(pricing).not.toBeUndefined();
        if (pricing === undefined) return;
        expect(pricing.inputPricePerMillion).toBeGreaterThan(0);
        expect(pricing.outputPricePerMillion).toBeGreaterThan(0);
        expect(pricing.useProviderCost).toBe(true);
      }
    });
  });

  describe('OPENROUTER_VALIDATION_MODEL', () => {
    it('is in the allowlist', () => {
      expect(isAllowedModel(OPENROUTER_VALIDATION_MODEL)).toBe(true);
    });

    it('has defined pricing', () => {
      const pricing = getAllowlistPricing(OPENROUTER_VALIDATION_MODEL);
      expect(pricing).not.toBeUndefined();
    });
  });

  describe('allowlistModelIds', () => {
    it('returns comma-separated list of all model IDs', () => {
      const ids = allowlistModelIds();
      expect(ids.split(', ')).toHaveLength(14);
      expect(ids).toContain('anthropic/claude-sonnet-4.6');
      expect(ids).toContain('x-ai/grok-4.1-fast');
    });
  });

  describe('buildModelInfo', () => {
    function getEntry(id: string): (typeof OPENROUTER_ALLOWED_MODELS)[number] {
      const entry = OPENROUTER_ALLOWED_MODELS.find((m) => m.id === id);
      if (entry === undefined) throw new Error(`Test setup: model ${id} not in allowlist`);
      return entry;
    }

    it('uses catalog pricing when available', () => {
      const catalog: CatalogEntry = {
        pricing: { inputPricePerMillion: 99.0, outputPricePerMillion: 199.0 },
        contextLength: 500_000,
      };
      const result = buildModelInfo(getEntry('qwen/qwen3.5-plus-02-15'), catalog);
      expect(result.pricing.inputPricePerMillion).toBe(99.0);
      expect(result.pricing.outputPricePerMillion).toBe(199.0);
      expect(result.contextLength).toBe(500_000);
      expect(result.pricing.useProviderCost).toBe(true);
    });

    it('falls back to allowlist pricing when catalog is undefined', () => {
      const entry = getEntry('qwen/qwen3.5-plus-02-15');
      const result = buildModelInfo(entry);
      expect(result.pricing.inputPricePerMillion).toBeGreaterThan(0);
      expect(result.pricing.outputPricePerMillion).toBeGreaterThan(0);
      expect(result.contextLength).toBe(entry.contextLength);
      expect(result.pricing.useProviderCost).toBe(true);
    });

    it('populates id, name, provider, and modalities from entry', () => {
      const entry = getEntry('qwen/qwen3.5-plus-02-15');
      const result = buildModelInfo(entry);
      expect(result.id).toBe(entry.id);
      expect(result.name).toBe(entry.name);
      expect(result.provider).toBe(entry.provider);
      expect(result.inputModalities).toEqual(['text']);
      expect(result.outputModalities).toEqual(['text']);
    });

    it('uses allowlist contextLength as fallback (not hardcoded 102400)', () => {
      // Grok 4.20 Beta has 2M context — should NOT fall back to 102400
      const result = buildModelInfo(getEntry('x-ai/grok-4.20-beta'));
      expect(result.contextLength).toBe(2_000_000);
    });
  });
});
