import type { UsageEvent } from './usageEvent.js';
import type { AggregateMetrics } from './usageQuery.js';

export interface ResearchCostSummaryRequest {
  researchId: string;
  owner?: {
    type: 'user' | 'system';
    id: string;
  };
  timeRange?: {
    from: string;
    to: string;
  };
}

export interface ResearchCostSummaryRow {
  eventId: string;
  occurredAt: string;
  owner: UsageEvent['owner'];
  source: UsageEvent['source'];
  provider: string;
  model: string;
  operation: string;
  promptType: string | null;
  success: boolean;
  requestId: string | null;
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
  costUsd: number;
  pricingSource: UsageEvent['cost']['pricingSource'];
}

export interface MissingAttributionDiagnostics {
  count: number;
  costUsd: number;
  eventIds: string[];
}

export interface ResearchCostSummaryResponse {
  researchId: string;
  owner?: {
    type: 'user' | 'system';
    id: string;
  };
  timeRange?: {
    from: string;
    to: string;
  };
  totals: AggregateMetrics;
  rows: ResearchCostSummaryRow[];
  diagnostics: {
    missingAttribution: MissingAttributionDiagnostics;
  };
}
