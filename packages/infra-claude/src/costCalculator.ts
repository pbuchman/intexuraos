import type { NormalizedUsage } from '@intexuraos/llm-contract';

export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  webSearchCalls: number
): NormalizedUsage {
  // Aggregate cache tokens to satisfy the shared contract
  const totalCacheTokens = cacheReadTokens + cacheWriteTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + totalCacheTokens,
    costUsd: 0,
    // Map both Read and Write into the single standard field
    ...(totalCacheTokens > 0 && { cacheTokens: totalCacheTokens }),
    ...(webSearchCalls > 0 && { webSearchCalls }),
  };
}
