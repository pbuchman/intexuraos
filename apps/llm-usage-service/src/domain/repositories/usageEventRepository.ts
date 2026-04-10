import type { Result } from '@intexuraos/common-core';
import type { UsageEvent } from '../models/usageEvent.js';

export type CreateEventResult = { status: 'created' } | { status: 'duplicate' };

export interface UsageEventFilters {
  ownerTypes?: ('user' | 'system')[];
  ownerIds?: string[];
  services?: string[];
  components?: string[];
  clients?: string[];
  providers?: string[];
  models?: string[];
  operations?: string[];
  success?: boolean;
}

export type SortField = 'occurredAt' | 'costUsd' | 'totalTokens';

export interface ListUsageEventsParams {
  timeRange: { from: string; to: string };
  filters?: UsageEventFilters;
  sortBy?: {
    field: SortField;
    direction: 'asc' | 'desc';
  };
  limit: number;
  cursor?: string;
}

export interface ListUsageEventsResult {
  events: UsageEvent[];
  nextCursor?: string;
  totalMatched: number;
}

export interface UsageEventRepository {
  createEvent(event: UsageEvent): Promise<Result<CreateEventResult, { code: string; message: string }>>;
  list(params: ListUsageEventsParams): Promise<Result<ListUsageEventsResult, { code: string; message: string }>>;
  getById(eventId: string): Promise<Result<UsageEvent | null, { code: string; message: string }>>;
}
