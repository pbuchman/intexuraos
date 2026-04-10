import type { Logger } from '@intexuraos/common-core';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { DailyUsageAggregate } from '../models/dailyAggregate.js';
import type {
  UsageQueryRequest,
  UsageQueryResponse,
  UsageQueryRow,
  AggregateMetrics,
} from '../models/usageQuery.js';
import {
  ALLOWED_GROUP_BY,
  ALLOWED_SORT_FIELDS,
  MAX_QUERY_LIMIT,
  DEFAULT_QUERY_LIMIT,
} from '../models/usageQuery.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';

export interface QueryUsageDeps {
  logger: Logger;
  usageAggregateRepository: UsageAggregateRepository;
}

function emptyMetrics(): AggregateMetrics {
  return {
    calls: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    thinkingTokens: 0,
    webSearchCalls: 0,
    imageCount: 0,
  };
}

function addMetrics(target: AggregateMetrics, agg: DailyUsageAggregate): void {
  target.calls += agg.calls;
  target.costUsd += agg.costUsd;
  target.inputTokens += agg.inputTokens;
  target.outputTokens += agg.outputTokens;
  target.totalTokens += agg.totalTokens;
  target.cacheReadTokens += agg.cacheReadTokens;
  target.cacheWriteTokens += agg.cacheWriteTokens;
  target.cachedTokens += agg.cachedTokens;
  target.reasoningTokens += agg.reasoningTokens;
  target.thinkingTokens += agg.thinkingTokens;
  target.webSearchCalls += agg.webSearchCalls;
  target.imageCount += agg.imageCount;
}

function getGroupKey(agg: DailyUsageAggregate, field: string): string | boolean {
  switch (field) {
    case 'day': return agg.date;
    case 'owner.type': return agg.ownerType;
    case 'owner.id': return agg.ownerId;
    case 'source.service': return agg.sourceService;
    case 'source.component': return agg.sourceComponent;
    case 'source.client': return agg.sourceClient;
    case 'request.provider': return agg.provider;
    case 'request.model': return agg.model;
    case 'request.operation': return agg.operation;
    case 'request.success': return agg.success;
    default: return '';
  }
}

function matchesFilters(agg: DailyUsageAggregate, filters: UsageQueryRequest['filters']): boolean {
  if (filters === undefined) {
    return true;
  }

  if (filters.ownerTypes !== undefined && !filters.ownerTypes.includes(agg.ownerType)) {
    return false;
  }
  if (filters.ownerIds !== undefined && !filters.ownerIds.includes(agg.ownerId)) {
    return false;
  }
  if (filters.services !== undefined && !filters.services.includes(agg.sourceService)) {
    return false;
  }
  if (filters.components !== undefined && !filters.components.includes(agg.sourceComponent)) {
    return false;
  }
  if (filters.clients !== undefined && !filters.clients.includes(agg.sourceClient)) {
    return false;
  }
  if (filters.providers !== undefined && !filters.providers.includes(agg.provider)) {
    return false;
  }
  if (filters.models !== undefined && !filters.models.includes(agg.model)) {
    return false;
  }
  if (filters.operations !== undefined && !filters.operations.includes(agg.operation)) {
    return false;
  }
  if (filters.success !== undefined && filters.success !== agg.success) {
    return false;
  }

  return true;
}

function getMetricValue(metrics: AggregateMetrics, field: string): number {
  switch (field) {
    case 'calls': return metrics.calls;
    case 'costUsd': return metrics.costUsd;
    case 'inputTokens': return metrics.inputTokens;
    case 'outputTokens': return metrics.outputTokens;
    case 'totalTokens': return metrics.totalTokens;
    case 'cacheReadTokens': return metrics.cacheReadTokens;
    case 'cacheWriteTokens': return metrics.cacheWriteTokens;
    case 'cachedTokens': return metrics.cachedTokens;
    case 'reasoningTokens': return metrics.reasoningTokens;
    case 'thinkingTokens': return metrics.thinkingTokens;
    case 'webSearchCalls': return metrics.webSearchCalls;
    case 'imageCount': return metrics.imageCount;
    default: return 0;
  }
}

export async function queryUsage(
  deps: QueryUsageDeps,
  request: UsageQueryRequest,
): Promise<Result<UsageQueryResponse, { code: string; message: string }>> {
  const { logger, usageAggregateRepository } = deps;

  // Validate groupBy
  const groupByFields = request.groupBy ?? [];
  for (const field of groupByFields) {
    if (!ALLOWED_GROUP_BY.includes(field as typeof ALLOWED_GROUP_BY[number])) {
      return err({ code: 'INVALID_GROUP_BY', message: `Invalid groupBy field: ${field}. Allowed: ${ALLOWED_GROUP_BY.join(', ')}` });
    }
  }

  // Validate sortBy
  if (request.sortBy !== undefined) {
    if (!ALLOWED_SORT_FIELDS.includes(request.sortBy.field as typeof ALLOWED_SORT_FIELDS[number])) {
      return err({ code: 'INVALID_SORT_FIELD', message: `Invalid sortBy field: ${request.sortBy.field}. Allowed: ${ALLOWED_SORT_FIELDS.join(', ')}` });
    }
  }

  const limit = Math.min(request.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

  // Fetch aggregates for the time range
  const aggregatesResult = await usageAggregateRepository.queryAggregates(
    request.timeRange.from,
    request.timeRange.to,
  );
  if (!aggregatesResult.ok) {
    return aggregatesResult;
  }

  const aggregates = aggregatesResult.value;

  // Apply filters
  const filtered = aggregates.filter((agg: DailyUsageAggregate) => matchesFilters(agg, request.filters));

  // Group
  const groups = new Map<string, { group: Record<string, string | boolean>; metrics: AggregateMetrics }>();

  for (const agg of filtered) {
    const groupValues: Record<string, string | boolean> = {};
    const keyParts: string[] = [];

    for (const field of groupByFields) {
      const value = getGroupKey(agg, field);
      groupValues[field] = value;
      keyParts.push(`${field}=${String(value)}`);
    }

    const key = keyParts.join('|');
    const existing = groups.get(key);

    if (existing !== undefined) {
      addMetrics(existing.metrics, agg);
    } else {
      const metrics = emptyMetrics();
      addMetrics(metrics, agg);
      groups.set(key, { group: groupValues, metrics });
    }
  }

  // Convert to rows
  let rows: UsageQueryRow[] = Array.from(groups.values());

  // Sort
  if (request.sortBy !== undefined) {
    const sortField = request.sortBy.field;
    const direction = request.sortBy.direction;
    rows.sort((a, b) => {
      const aVal = getMetricValue(a.metrics, sortField);
      const bVal = getMetricValue(b.metrics, sortField);
      return direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }

  // Apply limit
  rows = rows.slice(0, limit);

  // Compute totals from all filtered aggregates (not just limited rows)
  const totals = emptyMetrics();
  for (const agg of filtered) {
    addMetrics(totals, agg);
  }

  logger.info(
    { rowCount: rows.length, totalAggregates: filtered.length },
    'Usage query complete',
  );

  return ok({ rows, totals });
}
