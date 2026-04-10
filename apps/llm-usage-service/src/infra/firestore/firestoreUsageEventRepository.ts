import { ok, type Result } from '@intexuraos/common-core';
import type { UsageEvent } from '../../domain/models/usageEvent.js';
import type { CreateEventResult, UsageEventRepository } from '../../domain/repositories/usageEventRepository.js';

export class FirestoreUsageEventRepository implements UsageEventRepository {
  async createEvent(_event: UsageEvent): Promise<Result<CreateEventResult, { code: string; message: string }>> {
    // Stub implementation - will be completed in Task 3
    return ok({ status: 'created' as const });
  }
}
