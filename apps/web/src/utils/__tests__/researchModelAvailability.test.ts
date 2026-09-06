import { DEFAULT_PLATFORM_LLM_MODEL, LlmModels } from '@intexuraos/llm-contract';
import { describe, expect, it } from 'vitest';
import {
  RESEARCH_SYNTHESIS_MODELS,
  isStoredResearchModelAvailable,
  isStoredResearchSynthesisModelExecutable,
} from '../researchModelAvailability.js';

describe('researchModelAvailability', () => {
  it('allows only an OpenRouter model present in the active catalog', () => {
    expect(
      isStoredResearchModelAvailable('or:openai/gpt-5.4', ['openai/gpt-5.4']),
    ).toBe(true);
    expect(
      isStoredResearchModelAvailable('or:google/gemini-3-flash-preview', [
        'google/gemini-3.6-flash',
      ]),
    ).toBe(false);
    expect(isStoredResearchModelAvailable(LlmModels.GPT54, ['openai/gpt-5.4'])).toBe(false);
  });

  it('keeps the platform model first and exposes only or:* synthesis IDs', () => {
    expect(RESEARCH_SYNTHESIS_MODELS[0]).toBe(DEFAULT_PLATFORM_LLM_MODEL);
    expect(RESEARCH_SYNTHESIS_MODELS.every((model) => model.startsWith('or:'))).toBe(true);
  });

  it('requires a synthesis model to be both catalog-active and synthesis-allowlisted', () => {
    expect(
      isStoredResearchSynthesisModelExecutable('or:openai/gpt-5.4', [
        'openai/gpt-5.4',
      ]),
    ).toBe(true);
    expect(
      isStoredResearchSynthesisModelExecutable('or:google/gemini-3.6-flash', [
        'google/gemini-3.6-flash',
      ]),
    ).toBe(false);
  });
});
