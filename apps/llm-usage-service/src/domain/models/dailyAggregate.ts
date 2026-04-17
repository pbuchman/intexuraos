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
