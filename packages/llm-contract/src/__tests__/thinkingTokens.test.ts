import { describe, expect, it } from 'vitest';
import type { TokenUsage, NormalizedUsage } from '../types.js';

describe('thinkingTokens type support', () => {
  it('TokenUsage accepts thinkingTokens', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      thinkingTokens: 200,
    };
    expect(usage.thinkingTokens).toBe(200);
  });

  it('TokenUsage does not require thinkingTokens', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
    };
    expect(usage.thinkingTokens).toBeUndefined();
  });

  it('NormalizedUsage accepts thinkingTokens', () => {
    const usage: NormalizedUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.001,
      thinkingTokens: 200,
    };
    expect(usage.thinkingTokens).toBe(200);
  });

  it('NormalizedUsage does not require thinkingTokens', () => {
    const usage: NormalizedUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.001,
    };
    expect(usage.thinkingTokens).toBeUndefined();
  });
});
