/**
 * LLM Usage types for the web app.
 * Mirror of the canonical types in:
 *   - apps/llm-usage-service/src/domain/models/usageEvent.ts
 *   - apps/llm-usage-service/src/domain/models/usageQuery.ts
 *   - apps/llm-usage-service/src/domain/repositories/usageEventRepository.ts
 */

/** UsageEvent - canonical stored event (web-facing mirror) */
export interface UsageEvent {
  schemaVersion: 1;
  eventId: string;
  occurredAt: string;
  receivedAt: string;
  ingress: 'internal' | 'orchestrator_webhook';

  owner: {
    type: 'user' | 'system';
    id: string;
  };

  source: {
    service: string;
    component: string;
    client: string;
    environment: string;
    workerLocation?: string;
  };

  request: {
    provider: string;
    model: string;
    operation: string;
    success: boolean;
    durationMs: number;
    promptType?: string;
  };

  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    thinkingTokens: number;
    webSearchCalls: number;
    groundingEnabled: boolean;
    imageCount: number;
  };

  cost: {
    billedUsd: number;
    providerReportedUsd: number | null;
    calculatedUsd: number | null;
    pricingSource: string;
  };

  correlation: {
    requestId: string | null;
    traceId: string | null;
    taskId: string | null;
    researchId: string | null;
    attempt: number | null;
    sessionId: string | null;
  };

  error: {
    code: string | null;
    message: string | null;
  } | null;
}

export type UsageEventSortField = 'occurredAt' | 'costUsd' | 'totalTokens';

export interface UsageEventFilters {
  ownerTypes?: string[];
  ownerIds?: string[];
  services?: string[];
  components?: string[];
  clients?: string[];
  providers?: string[];
  models?: string[];
  operations?: string[];
  success?: boolean;
}

export interface ListLlmUsageEventsRequest {
  timeRange: { from: string; to: string };
  filters?: UsageEventFilters;
  sortBy?: { field: UsageEventSortField; direction: 'asc' | 'desc' };
  limit?: number;
  cursor?: string;
}

export interface ListLlmUsageEventsResponse {
  events: UsageEvent[];
  nextCursor?: string;
  totalMatched: number;
}

/** Single event response wrapper */
export interface GetUsageEventResponse {
  event: UsageEvent;
}

// Aggregate query types (mirror of usageQuery.ts)

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

export interface LlmUsageQueryRequest {
  timeRange: { from: string; to: string };
  filters?: UsageEventFilters;
  groupBy?: string[];
  sortBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

export interface LlmUsageQueryResponse {
  rows: UsageQueryRow[];
  totals: AggregateMetrics;
}
