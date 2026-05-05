import type { Result } from '@intexuraos/common-core';

export interface ResearchCostSummaryMetrics {
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

export interface ResearchCostSummaryDiagnostics {
  missingAttribution: {
    count: number;
    costUsd: number;
    eventIds: string[];
  };
}

export interface ResearchCostSummary {
  researchId: string;
  totals: ResearchCostSummaryMetrics;
  diagnostics: ResearchCostSummaryDiagnostics;
}

export interface ResearchCostSummaryTimeRange {
  from: string;
  to: string;
}

export interface ResearchCostSummaryClient {
  getResearchCostSummary(
    researchId: string,
    owner: { type: 'user' | 'system'; id: string },
    timeRange: ResearchCostSummaryTimeRange
  ): Promise<Result<ResearchCostSummary, { code: string; message: string }>>;
}
