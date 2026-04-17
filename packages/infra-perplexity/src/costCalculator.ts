import type { NormalizedUsage } from '@intexuraos/llm-contract';

export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  _providerCost: number | null | undefined
): NormalizedUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: 0,
    webSearchCalls: 1,
  };
}
