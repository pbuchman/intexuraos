import { describe, expect, it } from 'vitest';
import {
  getActiveSelectedModelsList,
  getSelectedModelsList,
  MAX_TOTAL_MODELS,
} from '../ModelSelector.js';

describe('getSelectedModelsList', () => {
  it('creates only unique OpenRouter executable IDs', () => {
    expect(
      getSelectedModelsList([
        'anthropic/claude-sonnet-4.6',
        'openai/gpt-5.4',
        'anthropic/claude-sonnet-4.6',
      ]),
    ).toEqual(['or:anthropic/claude-sonnet-4.6', 'or:openai/gpt-5.4']);
  });

  it('limits the executable selection to six models', () => {
    const ids = Array.from({ length: MAX_TOTAL_MODELS + 2 }, (_, index) => `vendor/model-${String(index)}`);

    expect(getSelectedModelsList(ids)).toHaveLength(MAX_TOTAL_MODELS);
  });

  it('drops selected IDs that are absent from the active OpenRouter catalog', () => {
    expect(
      getActiveSelectedModelsList(
        ['openai/gpt-5.4', 'google/gemini-3-flash-preview'],
        ['openai/gpt-5.4'],
      ),
    ).toEqual(['or:openai/gpt-5.4']);
  });
});
