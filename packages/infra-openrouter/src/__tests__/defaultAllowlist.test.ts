import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENROUTER_ALLOWED_MODELS,
  isDefaultAllowedModel,
  type DefaultAllowedOpenRouterModel,
} from '../defaultAllowlist.js';

describe('defaultAllowlist', () => {
  describe('DEFAULT_OPENROUTER_ALLOWED_MODELS', () => {
    it('has exactly 5 entries', () => {
      expect(DEFAULT_OPENROUTER_ALLOWED_MODELS).toHaveLength(5);
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
      expect(ids).toContain('google/gemma-4-31b-it');
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
      expect(isDefaultAllowedModel('google/gemma-4-31b-it')).toBe(true);
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
});
