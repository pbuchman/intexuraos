export const MISSING_PROMPT_TYPE_SENTINEL = '__missing__';

export interface DailyUsageAggregate {
  aggregateId: string;
  date: string;

  ownerType: 'user' | 'system';
  ownerId: string;

  sourceService: string;
  sourceComponent: string;
  sourceClient: string;
  sourceEnvironment: string;

  provider: string;
  model: string;
  operation: string;
  promptType: string;
  success: boolean;

  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  thinkingTokens: number;
  webSearchCalls: number;
  imageCount: number;

  firstOccurredAt: string;
  lastOccurredAt: string;
  updatedAt: string;
}
