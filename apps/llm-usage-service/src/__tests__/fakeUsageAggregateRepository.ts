import { ok, err, type Result } from '@intexuraos/common-core';
import type { UsageEvent } from '../domain/models/usageEvent.js';
import type { DailyUsageAggregate } from '../domain/models/dailyAggregate.js';
import type { UsageAggregateRepository } from '../domain/repositories/usageAggregateRepository.js';

export class FakeUsageAggregateRepository implements UsageAggregateRepository {
  private readonly aggregates: DailyUsageAggregate[] = [];
  private failWith: { code: string; message: string } | null = null;

  async incrementAggregate(_event: UsageEvent): Promise<Result<void, { code: string; message: string }>> {
    if (this.failWith !== null) {
      return err(this.failWith);
    }
    return ok(undefined);
  }

  async queryAggregates(_from: string, _to: string): Promise<Result<DailyUsageAggregate[], { code: string; message: string }>> {
    if (this.failWith !== null) {
      return err(this.failWith);
    }
    return ok(this.aggregates);
  }

  addAggregate(aggregate: DailyUsageAggregate): void {
    this.aggregates.push(aggregate);
  }

  setFailure(error: { code: string; message: string }): void {
    this.failWith = error;
  }

  clear(): void {
    this.aggregates.length = 0;
    this.failWith = null;
  }
}
