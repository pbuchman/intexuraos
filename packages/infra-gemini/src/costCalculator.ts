import type { NormalizedUsage } from '@intexuraos/llm-contract';

export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  groundingEnabled: boolean,
  thinkingTokens?: number
): NormalizedUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: 0,
    ...(groundingEnabled && { groundingEnabled: true }),
    ...(thinkingTokens !== undefined && thinkingTokens > 0 && { thinkingTokens }),
  };
}
