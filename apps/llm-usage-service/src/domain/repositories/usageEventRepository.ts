import type { Result } from '@intexuraos/common-core';
import type { UsageEvent } from '../models/usageEvent.js';

export type CreateEventResult = { status: 'created' } | { status: 'duplicate' };

export interface UsageEventRepository {
  createEvent(event: UsageEvent): Promise<Result<CreateEventResult, { code: string; message: string }>>;
}
