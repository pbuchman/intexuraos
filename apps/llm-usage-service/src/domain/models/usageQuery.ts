export interface UsageQueryRequest {
  timeRange: {
    from: string;
    to: string;
  };
  filters?: {
    ownerTypes?: ('user' | 'system')[];
    ownerIds?: string[];
    services?: string[];
    components?: string[];
    clients?: string[];
    providers?: string[];
    models?: string[];
    operations?: string[];
    success?: boolean;
  };
  groupBy?: string[];
  sortBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
}

export const ALLOWED_GROUP_BY = [
  'day',
  'owner.type',
  'owner.id',
  'source.service',
  'source.component',
  'source.client',
  'request.provider',
  'request.model',
  'request.operation',
  'request.success',
] as const;

export const ALLOWED_SORT_FIELDS = [
  'calls', 'costUsd', 'inputTokens', 'outputTokens', 'totalTokens',
  'cacheReadTokens', 'cacheWriteTokens', 'cachedTokens',
  'reasoningTokens', 'thinkingTokens', 'webSearchCalls', 'imageCount',
] as const;

export interface AggregateMetrics {
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
}

export interface UsageQueryRow {
  group: Record<string, string | boolean>;
  metrics: AggregateMetrics;
}

export interface UsageQueryResponse {
  rows: UsageQueryRow[];
  totals: AggregateMetrics;
}

export const MAX_QUERY_LIMIT = 500;
export const DEFAULT_QUERY_LIMIT = 100;
