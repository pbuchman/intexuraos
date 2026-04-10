import { ok, err, type Result } from '@intexuraos/common-core';
import type { UsageEvent } from '../domain/models/usageEvent.js';
import type { CreateEventResult, UsageEventRepository } from '../domain/repositories/usageEventRepository.js';

export class FakeUsageEventRepository implements UsageEventRepository {
  private readonly events = new Map<string, UsageEvent>();
  private failWith: { code: string; message: string } | null = null;

  async createEvent(event: UsageEvent): Promise<Result<CreateEventResult, { code: string; message: string }>> {
    if (this.failWith !== null) {
      return err(this.failWith);
    }

    if (this.events.has(event.eventId)) {
      return ok({ status: 'duplicate' as const });
    }

    this.events.set(event.eventId, event);
    return ok({ status: 'created' as const });
  }

  getStoredEvents(): UsageEvent[] {
    return Array.from(this.events.values());
  }

  setFailure(error: { code: string; message: string }): void {
    this.failWith = error;
  }

  clearFailure(): void {
    this.failWith = null;
  }

  clear(): void {
    this.events.clear();
    this.failWith = null;
  }
}
