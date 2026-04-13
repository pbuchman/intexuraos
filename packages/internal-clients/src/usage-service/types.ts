import type { Logger, Result } from '@intexuraos/common-core';
import type { LlmProvider } from '@intexuraos/llm-contract';

export interface UsageServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

// Re-use the event types inline (don't import from llm-usage-service app)
// Define minimal types needed for the client

export interface UsageEventOwner {
  type: 'user' | 'system';
  id: string;
}

export interface UsageEventSource {
  service: string;
  component: string;
  client: string;
  environment: 'dev' | 'prod' | 'test';
  /**
   * Physical location identifier of the orchestrator that produced this event
   * (e.g. 'home-dev', 'mac-dev', 'office-pc'). Required at the webhook endpoint
   * (enforced by the OrchestratorUsageEventInput schema); optional on the internal endpoint.
   */
  workerLocation?: string;
}

export interface UsageEventRequest {
  provider: LlmProvider;
  model: string;
  operation:
    | 'research'
    | 'generate'
    | 'image_generation'
    | 'tool_calling'
    | 'other';
  success: boolean;
  durationMs: number;
}

export interface UsageEventUsage {
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
}

export interface UsageEventCost {
  billedUsd: number;
  providerReportedUsd: number | null;
  calculatedUsd: number | null;
  pricingSource: 'provider_reported' | 'calculated' | 'mixed' | 'external';
}

export interface UsageEventCorrelation {
  requestId: string | null;
  traceId: string | null;
  taskId: string | null;
  researchId: string | null;
  attempt: number | null;
  sessionId: string | null;
}

export interface UsageEventError {
  code: string | null;
  message: string | null;
}

export interface UsageEventInput {
  schemaVersion: 1;
  eventId: string;
  occurredAt: string;
  owner: UsageEventOwner;
  source: UsageEventSource;
  request: UsageEventRequest;
  usage: UsageEventUsage;
  cost: UsageEventCost;
  correlation: UsageEventCorrelation;
  error: UsageEventError | null;
}

export interface UsageIngestRequest {
  schemaVersion: 1;
  events: UsageEventInput[];
}

export interface RejectedEvent {
  index: number;
  code: string;
  message: string;
}

export interface UsageIngestResponse {
  accepted: number;
  duplicates: number;
  rejected: RejectedEvent[];
}

export interface UsageQueryTimeRange {
  from: string;
  to: string;
}

export interface UsageQueryFilters {
  ownerTypes?: ('user' | 'system')[];
  ownerIds?: string[];
  services?: string[];
  components?: string[];
  clients?: string[];
  providers?: string[];
  models?: string[];
  operations?: string[];
  success?: boolean;
}

export interface UsageQuerySortBy {
  field: string;
  direction: 'asc' | 'desc';
}

export interface UsageQueryRequest {
  timeRange: UsageQueryTimeRange;
  filters?: UsageQueryFilters;
  groupBy?: string[];
  sortBy?: UsageQuerySortBy;
  limit?: number;
}

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

/** Stored event with server-populated fields (receivedAt, ingress) */
export interface StoredUsageEvent extends UsageEventInput {
  receivedAt: string;
  ingress: 'internal' | 'orchestrator_webhook';
}

export interface UsageListEventsRequest {
  timeRange: { from: string; to: string };
  filters?: UsageQueryFilters;
  sortBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  cursor?: string;
}

export interface UsageListEventsResponse {
  events: StoredUsageEvent[];
  nextCursor?: string;
  totalMatched: number;
}

export interface UsageGetEventResponse {
  event: StoredUsageEvent;
}

export interface UsageServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'VALIDATION_ERROR';
  message: string;
}

/**
 * Pricing data for a single LLM provider.
 * Mirrors the ProviderPricing shape from @intexuraos/llm-contract.
 */
export interface PricingProviderEntry {
  provider: string;
  models: Record<string, PricingModelEntry>;
  updatedAt: string;
  useProviderCost?: boolean;
  costSource?: string;
}

export interface PricingModelEntry {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Record<string, number>;
  useProviderCost?: boolean;
}

/**
 * Response shape for fetchPricing() — keyed by provider name.
 */
export type PricingResponse = Record<string, PricingProviderEntry>;

export interface UsageServiceClient {
  ingestEvents(
    request: UsageIngestRequest,
    options?: { traceId?: string }
  ): Promise<Result<UsageIngestResponse, UsageServiceError>>;

  queryUsage(
    request: UsageQueryRequest,
    options?: { traceId?: string }
  ): Promise<Result<UsageQueryResponse, UsageServiceError>>;

  fetchPricing(options?: { traceId?: string }): Promise<Result<PricingResponse, UsageServiceError>>;

  listUsageEvents(
    request: UsageListEventsRequest,
    options?: { traceId?: string }
  ): Promise<Result<UsageListEventsResponse, UsageServiceError>>;

  getUsageEvent(
    eventId: string,
    options?: { traceId?: string }
  ): Promise<Result<UsageGetEventResponse, UsageServiceError>>;
}
