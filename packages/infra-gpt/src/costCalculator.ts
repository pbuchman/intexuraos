import type { NormalizedUsage } from '@intexuraos/llm-contract';

export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  webSearchCalls: number,
  reasoningTokens: number | undefined
): NormalizedUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: 0,
    ...(cachedTokens > 0 && { cacheTokens: cachedTokens }),
    ...(reasoningTokens !== undefined && reasoningTokens > 0 && { reasoningTokens }),
    ...(webSearchCalls > 0 && { webSearchCalls }),
  };
}
