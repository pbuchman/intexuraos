/**
 * Port interfaces for data insights domain.
 * These define the contracts for external adapters.
 */

import type { Result } from '@intexuraos/common-core';
import type {
  AnalyticsEvent,
  AggregatedInsights,
  CreateAnalyticsEventRequest,
} from '../models/index.js';

/**
 * Repository for analytics events.
 */
export interface AnalyticsEventRepository {
  /**
   * Create a new analytics event.
   */
  create(request: CreateAnalyticsEventRequest): Promise<Result<AnalyticsEvent, string>>;

  /**
   * Get events for a user within a time range.
   */
  getByUserIdAndTimeRange(
    userId: string,
    startDate: Date,
    endDate: Date,
    limit?: number
  ): Promise<Result<AnalyticsEvent[], string>>;

  /**
   * Count events for a user by service.
   */
  countByUserIdAndService(
    userId: string,
    serviceNames: string[]
  ): Promise<Result<Record<string, number>, string>>;
}

/**
 * Repository for aggregated insights.
 */
export interface AggregatedInsightsRepository {
  /**
   * Get aggregated insights for a user.
   */
  getByUserId(userId: string): Promise<Result<AggregatedInsights | null, string>>;

  /**
   * Update aggregated insights for a user.
   */
  upsert(insights: AggregatedInsights): Promise<Result<void, string>>;
}
