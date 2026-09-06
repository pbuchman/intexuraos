import { describe, expect, it, vi } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import { getEnhanceModelCapacity } from '../EnhanceModal.js';

vi.mock('@/config', () => ({ config: {} }));

describe('getEnhanceModelCapacity', () => {
  it('counts only completed results that will be copied into the enhanced research', () => {
    const capacity = getEnhanceModelCapacity([
      { model: 'or:openai/gpt-5.4', status: 'completed' },
      { model: 'or:google/gemini-3.6-flash', status: 'failed' },
      { model: LlmModels.ClaudeSonnet46, status: 'completed' },
    ]);

    expect(capacity.completedModelCount).toBe(2);
    expect(capacity.remainingSlots).toBe(4);
    expect(capacity.completedOpenRouterRawIds).toEqual(
      new Set(['openai/gpt-5.4']),
    );
  });

  it('deduplicates copied results before applying the six-model limit', () => {
    const capacity = getEnhanceModelCapacity([
      { model: 'or:openai/gpt-5.4', status: 'completed' },
      { model: 'or:openai/gpt-5.4', status: 'completed' },
    ]);

    expect(capacity.completedModelCount).toBe(1);
    expect(capacity.remainingSlots).toBe(5);
  });
});
