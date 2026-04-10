import { ok, type Result } from '@intexuraos/common-core';
import type { UsageEvent } from '../../domain/models/usageEvent.js';
import type { DailyUsageAggregate } from '../../domain/models/dailyAggregate.js';
import type { UsageAggregateRepository } from '../../domain/repositories/usageAggregateRepository.js';

export class FirestoreUsageAggregateRepository implements UsageAggregateRepository {
  async incrementAggregate(_event: UsageEvent): Promise<Result<void, { code: string; message: string }>> {
    // Stub implementation - will be completed in Task 3
    return ok(undefined);
  }

  async queryAggregates(_from: string, _to: string): Promise<Result<DailyUsageAggregate[], { code: string; message: string }>> {
    // Stub implementation - will be completed in Task 3
    return ok([]);
  }
}
