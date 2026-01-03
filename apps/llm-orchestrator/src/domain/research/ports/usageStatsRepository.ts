import type { LlmUsageStats, LlmUsageIncrement } from '../models/LlmUsageStats.js';

export interface UsageStatsRepository {
  /**
   * Increment usage stats for a model.
   * Updates total, monthly, and daily aggregates atomically.
   */
  increment(data: LlmUsageIncrement): Promise<void>;

  /**
   * Get all-time usage stats for all models.
   */
  getAllTotals(): Promise<LlmUsageStats[]>;

  /**
   * Get usage stats for a specific period (e.g., '2026-01' for monthly).
   */
  getByPeriod(period: string): Promise<LlmUsageStats[]>;
}
