/**
 * Domain ports for app-settings-service.
 */

// Usage stats types for LLM cost visualization
export interface DailyCost {
  date: string;
  costUsd: number;
  calls: number;
}

export interface MonthlyCost {
  month: string;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  percentage: number;
}

export interface ModelCost {
  model: string;
  costUsd: number;
  calls: number;
  percentage: number;
}

export interface CallTypeCost {
  callType: string;
  costUsd: number;
  calls: number;
  percentage: number;
}

export interface AggregatedCosts {
  totalCostUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  monthlyBreakdown: MonthlyCost[];
  byModel: ModelCost[];
  byCallType: CallTypeCost[];
}

export interface UsageStatsRepository {
  getUserCosts(userId: string, days?: number): Promise<AggregatedCosts>;
}
