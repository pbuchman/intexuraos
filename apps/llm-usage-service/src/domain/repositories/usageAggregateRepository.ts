import type { Result } from '@intexuraos/common-core';
import type { UsageEvent } from '../models/usageEvent.js';
import type { DailyUsageAggregate } from '../models/dailyAggregate.js';

export interface UsageAggregateRepository {
  incrementAggregate(event: UsageEvent): Promise<Result<void, { code: string; message: string }>>;
  queryAggregates(from: string, to: string): Promise<Result<DailyUsageAggregate[], { code: string; message: string }>>;
}
