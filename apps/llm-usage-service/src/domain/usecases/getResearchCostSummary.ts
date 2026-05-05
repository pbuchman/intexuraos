import type { Logger } from '@intexuraos/common-core';
import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  ResearchCostSummaryRequest,
  ResearchCostSummaryResponse,
  ResearchCostSummaryRow,
  MissingAttributionDiagnostics,
} from '../models/researchCostSummary.js';
import type { AggregateMetrics } from '../models/usageQuery.js';
import type { UsageEvent } from '../models/usageEvent.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';

export interface GetResearchCostSummaryDeps {
  logger: Logger;
  usageEventRepository: UsageEventRepository;
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

function addEventToMetrics(metrics: AggregateMetrics, event: UsageEvent): void {
  metrics.calls += 1;
  metrics.costUsd += event.cost.billedUsd;
  metrics.inputTokens += event.usage.inputTokens;
  metrics.outputTokens += event.usage.outputTokens;
  metrics.totalTokens += event.usage.totalTokens;
  metrics.cacheReadTokens += event.usage.cacheReadTokens;
  metrics.cacheWriteTokens += event.usage.cacheWriteTokens;
  metrics.cachedTokens += event.usage.cachedTokens;
  metrics.reasoningTokens += event.usage.reasoningTokens;
  metrics.thinkingTokens += event.usage.thinkingTokens;
  metrics.webSearchCalls += event.usage.webSearchCalls;
  metrics.imageCount += event.usage.imageCount;
}

function toRow(event: UsageEvent): ResearchCostSummaryRow {
  return {
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    owner: event.owner,
    source: event.source,
    provider: event.request.provider,
    model: event.request.model,
    operation: event.request.operation,
    promptType: event.request.promptType ?? null,
    success: event.request.success,
    requestId: event.correlation.requestId,
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
    totalTokens: event.usage.totalTokens,
    cacheReadTokens: event.usage.cacheReadTokens,
    cacheWriteTokens: event.usage.cacheWriteTokens,
    cachedTokens: event.usage.cachedTokens,
    reasoningTokens: event.usage.reasoningTokens,
    thinkingTokens: event.usage.thinkingTokens,
    webSearchCalls: event.usage.webSearchCalls,
    imageCount: event.usage.imageCount,
    costUsd: event.cost.billedUsd,
    pricingSource: event.cost.pricingSource,
  };
}

function buildMissingAttributionDiagnostics(events: UsageEvent[]): MissingAttributionDiagnostics {
  const metrics = emptyMetrics();
  for (const event of events) {
    addEventToMetrics(metrics, event);
  }

  return {
    count: events.length,
    costUsd: metrics.costUsd,
    eventIds: events.map((event) => event.eventId),
  };
}

export async function getResearchCostSummary(
  deps: GetResearchCostSummaryDeps,
  request: ResearchCostSummaryRequest,
): Promise<Result<ResearchCostSummaryResponse, { code: string; message: string }>> {
  const { logger, usageEventRepository } = deps;

  if (request.researchId.trim() === '') {
    return err({ code: 'INVALID_REQUEST', message: 'researchId is required' });
  }

  if (request.timeRange !== undefined && request.timeRange.from > request.timeRange.to) {
    return err({
      code: 'INVALID_TIME_RANGE',
      message: 'timeRange.from must be less than or equal to timeRange.to',
    });
  }

  const eventsResult = await usageEventRepository.findResearchCostSummaryEvents(request);
  if (!eventsResult.ok) {
    return eventsResult;
  }

  const correlatedEvents = [...eventsResult.value.correlatedEvents].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId)
  );
  const missingAttributionEvents = [...eventsResult.value.missingAttributionEvents].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId)
  );

  const totals = emptyMetrics();
  for (const event of correlatedEvents) {
    addEventToMetrics(totals, event);
  }

  logger.info(
    {
      researchId: request.researchId,
      rowCount: correlatedEvents.length,
      missingAttributionCount: missingAttributionEvents.length,
    },
    'Research cost summary complete',
  );

  const response: ResearchCostSummaryResponse = {
    researchId: request.researchId,
    ...(request.owner !== undefined ? { owner: request.owner } : {}),
    ...(request.timeRange !== undefined ? { timeRange: request.timeRange } : {}),
    totals,
    rows: correlatedEvents.map(toRow),
    diagnostics: {
      missingAttribution: buildMissingAttributionDiagnostics(missingAttributionEvents),
    },
  };

  return ok(response);
}
