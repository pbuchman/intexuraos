import { describe, expect, it } from 'vitest';
import {
  OPENROUTER_ALLOWED_MODELS,
  OPENROUTER_VALIDATION_MODEL,
  isAllowedModel,
  allowlistModelIds,
  buildModelInfo,
  type CatalogEntry,
} from '../allowlist.js';
import { LegacyGoogleModels } from '@intexuraos/llm-contract';

const LEGACY_MIMO_MODEL_ID = 'xiaomi/mimo-' + 'v2-pro';

describe('allowlist', () => {
  describe('OPENROUTER_ALLOWED_MODELS', () => {
    it('has exactly 16 entries', () => {
      expect(OPENROUTER_ALLOWED_MODELS).toHaveLength(16);
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
      // xAI models
      expect(byId('x-ai/grok-4.20-beta')?.contextLength).toBe(2_000_000);
      expect(byId('x-ai/grok-4.3')?.contextLength).toBe(1_000_000);
      // MiniMax: 205K
      expect(byId('minimax/minimax-m3')?.contextLength).toBe(205_000);
      // Z.ai: 203K
      expect(byId('z-ai/glm-5-turbo')?.contextLength).toBe(203_000);
      // Moonshot: 262K
      expect(byId('moonshotai/kimi-k2.5')?.contextLength).toBe(262_000);
    });

    it('admits raw DeepSeek V4 Flash with its reviewed fallback metadata', () => {
      const entry = OPENROUTER_ALLOWED_MODELS.find(
        (model) => model.id === 'deepseek/deepseek-v4-flash'
      );

      expect(entry).toEqual({
        id: 'deepseek/deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        provider: 'DeepSeek',
        contextLength: 1_048_576,
        promptPerToken: '0.000000098',
        completionPerToken: '0.000000196',
      });
    });

    it('uses reviewed Gemini 3.6 Flash context and fallback pricing', () => {
      const entry = OPENROUTER_ALLOWED_MODELS.find(
        (model) => model.id === 'google/gemini-3.6-flash'
      );

      expect(entry).toEqual({
        id: 'google/gemini-3.6-flash',
        name: 'Gemini 3.6 Flash',
        provider: 'Google',
        contextLength: 1_048_576,
        promptPerToken: '0.0000015',
        completionPerToken: '0.0000075',
      });
    });

    it('uses official Grok 4.3 context and fallback pricing', () => {
      const entry = OPENROUTER_ALLOWED_MODELS.find((model) => model.id === 'x-ai/grok-4.3');

      expect(entry).toEqual({
        id: 'x-ai/grok-4.3',
        name: 'Grok 4.3',
        provider: 'xAI',
        contextLength: 1_000_000,
        promptPerToken: '0.00000125',
        completionPerToken: '0.0000025',
      });
    });

    it('all model IDs are in provider/model format', () => {
      for (const model of OPENROUTER_ALLOWED_MODELS) {
        expect(model.id).toMatch(/^[a-z0-9-]+\/[a-z0-9._-]+$/);
      }
    });
  });

  describe('isAllowedModel', () => {
    it('returns true for known model IDs', () => {
      expect(isAllowedModel('deepseek/deepseek-v4-flash')).toBe(true);
      expect(isAllowedModel('qwen/qwen3.5-plus-02-15')).toBe(true);
      expect(isAllowedModel('anthropic/claude-sonnet-4.6')).toBe(true);
      expect(isAllowedModel('x-ai/grok-4.3')).toBe(true);
      expect(isAllowedModel('openai/gpt-5.4')).toBe(true);
      expect(isAllowedModel('xiaomi/mimo-v2.5-pro')).toBe(true);
    });

    it('returns false for unknown model IDs', () => {
      expect(isAllowedModel('unknown/model')).toBe(false);
      expect(isAllowedModel(LegacyGoogleModels.Gemini25Pro)).toBe(false);
      expect(isAllowedModel('')).toBe(false);
      expect(isAllowedModel(LEGACY_MIMO_MODEL_ID)).toBe(false);
    });

    it('returns false for or: prefixed IDs (expecting raw ID)', () => {
      expect(isAllowedModel('or:anthropic/claude-sonnet-4.6')).toBe(false);
    });

    it('accepts Gemini 3.6 Flash and retires Gemini 3 Flash Preview', () => {
      expect(isAllowedModel('google/gemini-3.6-flash')).toBe(true);
      expect(isAllowedModel('google/gemini-3-flash-preview')).toBe(false);
    });

    it('accepts Grok 4.3 and retires deprecated Grok 4.1 Fast', () => {
      expect(isAllowedModel('x-ai/grok-4.3')).toBe(true);
      expect(isAllowedModel('x-ai/grok-4.1-fast')).toBe(false);
    });
  });

  describe('OPENROUTER_VALIDATION_MODEL', () => {
    it('is in the allowlist', () => {
      expect(isAllowedModel(OPENROUTER_VALIDATION_MODEL)).toBe(true);
    });
  });

  describe('allowlistModelIds', () => {
    it('returns comma-separated list of all model IDs', () => {
      const ids = allowlistModelIds();
      expect(ids.split(', ')).toHaveLength(16);
      expect(ids).toContain('deepseek/deepseek-v4-flash');
      expect(ids).toContain('anthropic/claude-sonnet-4.6');
      expect(ids).toContain('x-ai/grok-4.3');
      expect(ids).not.toContain('x-ai/grok-4.1-fast');
      expect(ids).toContain('xiaomi/mimo-v2.5-pro');
      expect(ids).not.toContain(LEGACY_MIMO_MODEL_ID);
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

    it('exposes MiMo Pro 2.5 metadata and fallback pricing', () => {
      const result = buildModelInfo(getEntry('xiaomi/mimo-v2.5-pro'));
      expect(result.name).toBe('MiMo V2.5 Pro');
      expect(result.provider).toBe('Xiaomi');
      expect(result.contextLength).toBe(1_000_000);
      expect(result.pricing.inputPricePerMillion).toBe(0.435);
      expect(result.pricing.outputPricePerMillion).toBe(0.87);
    });
  });
});
