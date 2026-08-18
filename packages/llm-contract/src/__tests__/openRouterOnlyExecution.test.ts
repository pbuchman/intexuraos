import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLATFORM_LLM_MODEL,
  EXECUTABLE_LLM_PROVIDERS,
  LlmModels,
  LlmProviders,
  normalizeLlmModelPreferenceForRead,
  RESEARCH_SYNTHESIS_MODELS,
  DEFAULT_RESEARCH_SYNTHESIS_MODEL,
  isDefaultEligibleModel,
  isOpenRouterModel,
} from '../index.js';

describe('OpenRouter-only execution contract', () => {
  it('exposes OpenRouter as the only executable provider', () => {
    expect(EXECUTABLE_LLM_PROVIDERS).toEqual([LlmProviders.OpenRouter]);
  });

  it('accepts only curated OpenRouter models as executable preferences', () => {
    expect(isDefaultEligibleModel(DEFAULT_PLATFORM_LLM_MODEL)).toBe(true);
    expect(isDefaultEligibleModel(LlmModels.GPT4oMini)).toBe(false);
    expect(isDefaultEligibleModel(LlmModels.ClaudeHaiku35)).toBe(false);
    expect(isDefaultEligibleModel(LlmModels.Sonar)).toBe(false);
    expect(isDefaultEligibleModel('or:unknown/not-curated')).toBe(false);
  });

  it('normalizes executable legacy preferences without changing history types', () => {
    expect(normalizeLlmModelPreferenceForRead('or:google/gemini-3-flash-preview')).toBe(
      'or:google/gemini-3.6-flash'
    );
    expect(normalizeLlmModelPreferenceForRead(LlmModels.GPT4oMini)).toBe(
      DEFAULT_PLATFORM_LLM_MODEL
    );
    expect(normalizeLlmModelPreferenceForRead('unknown-stored-model')).toBe(
      DEFAULT_PLATFORM_LLM_MODEL
    );
  });

  it('publishes a deterministic OpenRouter-only synthesis allowlist', () => {
    expect(DEFAULT_RESEARCH_SYNTHESIS_MODEL).toBe(DEFAULT_PLATFORM_LLM_MODEL);
    expect(RESEARCH_SYNTHESIS_MODELS[0]).toBe(DEFAULT_RESEARCH_SYNTHESIS_MODEL);
    expect(RESEARCH_SYNTHESIS_MODELS).toHaveLength(2);
    expect(RESEARCH_SYNTHESIS_MODELS.every(isOpenRouterModel)).toBe(true);
    expect(RESEARCH_SYNTHESIS_MODELS).toContain('or:openai/gpt-5.4');
  });
});
