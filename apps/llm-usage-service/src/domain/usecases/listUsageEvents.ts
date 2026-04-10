import type { Logger } from '@intexuraos/common-core';
import { err, ok, type Result } from '@intexuraos/common-core';
import { decodeCursor } from '../models/cursor.js';
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from '../models/usageEvent.js';
import type { UsageEventRepository, UsageEventFilters, SortField, ListUsageEventsResult } from '../repositories/usageEventRepository.js';

const ALLOWED_SORT_FIELDS: readonly SortField[] = ['occurredAt', 'costUsd', 'totalTokens'];

export interface ListUsageEventsRequest {
  timeRange: {
    from: string;
    to: string;
  };
  filters?: UsageEventFilters;
  sortBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
  cursor?: string;
}

export interface ListUsageEventsDeps {
  logger: Logger;
  usageEventRepository: UsageEventRepository;
}

export async function listUsageEvents(
  deps: ListUsageEventsDeps,
  request: ListUsageEventsRequest,
): Promise<Result<ListUsageEventsResult, { code: string; message: string }>> {
  const { logger, usageEventRepository } = deps;

  // Validate timeRange: from must be <= to
  if (request.timeRange.from > request.timeRange.to) {
    return err({
      code: 'INVALID_TIME_RANGE',
      message: 'timeRange.from must be less than or equal to timeRange.to',
    });
  }

  // Validate sortBy field
  const sortField: SortField = 'occurredAt';
  let sortDirection: 'asc' | 'desc' = 'desc';

  if (request.sortBy !== undefined) {
    if (!ALLOWED_SORT_FIELDS.includes(request.sortBy.field as SortField)) {
      return err({
        code: 'INVALID_SORT_FIELD',
        message: `Invalid sortBy field: ${request.sortBy.field}. Allowed: ${ALLOWED_SORT_FIELDS.join(', ')}`,
      });
    }
    sortDirection = request.sortBy.direction;
  }

  const validatedSortField: SortField = request.sortBy !== undefined
    ? (request.sortBy.field as SortField)
    : sortField;

  // Clamp limit
  const limit = Math.min(request.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

  // Validate cursor
  if (request.cursor !== undefined) {
    const decoded = decodeCursor(request.cursor);
    if (decoded === null) {
      return err({
        code: 'INVALID_CURSOR',
        message: 'Invalid or malformed cursor',
      });
    }
  }

  const result = await usageEventRepository.list({
    timeRange: request.timeRange,
    ...(request.filters !== undefined ? { filters: request.filters } : {}),
    sortBy: {
      field: validatedSortField,
      direction: sortDirection,
    },
    limit,
    ...(request.cursor !== undefined ? { cursor: request.cursor } : {}),
  });

  if (!result.ok) {
    return result;
  }

  logger.info(
    { eventCount: result.value.events.length, totalMatched: result.value.totalMatched },
    'Usage events listed',
  );

  return ok(result.value);
}
