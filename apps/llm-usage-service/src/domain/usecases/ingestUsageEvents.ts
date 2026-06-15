import type { Logger } from '@intexuraos/common-core';
import { getErrorMessage, isErr } from '@intexuraos/common-core';
import type { UsageEventInput, UsageEvent, UsageIngestResponse, RejectedEvent } from '../models/usageEvent.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';
import type { PricingCache } from '../services/pricingCache.js';
import { calculateCost } from '../services/costCalculation.js';

export interface IngestUsageEventsDeps {
  logger: Logger;
  usageEventRepository: UsageEventRepository;
  usageAggregateRepository: UsageAggregateRepository;
  pricingCache: PricingCache;
}

export async function ingestUsageEvents(
  deps: IngestUsageEventsDeps,
  events: UsageEventInput[],
  ingress: 'internal' | 'orchestrator_webhook',
): Promise<UsageIngestResponse> {
  const { logger, usageEventRepository, usageAggregateRepository, pricingCache } = deps;

  let accepted = 0;
  let duplicates = 0;
  const rejected: RejectedEvent[] = [];
  const pricingMissingEvents: { provider: string; model: string }[] = [];

  const receivedAt = new Date().toISOString();

  for (let i = 0; i < events.length; i++) {
    const input = events[i];
    if (input === undefined) {
      continue;
    }

    let resolvedCost: ResolvedCost;
    try {
      resolvedCost = await resolveCost(input, pricingCache, logger);
    } catch (e) {
      const message = getErrorMessage(e);
      logger.error(
        {
          eventId: input.eventId,
          provider: input.request.provider,
          model: input.request.model,
          err: message,
        },
        'resolveCost threw; rejecting event with PRICING_MISSING',
      );
      rejected.push({
        index: i,
        code: 'PRICING_MISSING',
        message,
      });
      pricingMissingEvents.push({
        provider: input.request.provider,
        model: input.request.model,
      });
      continue;
    }

    const fullEvent = enrichEvent(input, receivedAt, ingress, resolvedCost);

    const createResult = await usageEventRepository.createEvent(fullEvent);
    if (!createResult.ok) {
      logger.error(
        { eventId: input.eventId, error: createResult.error },
        'Failed to create usage event',
      );
      rejected.push({
        index: i,
        code: createResult.error.code,
        message: createResult.error.message,
      });
      continue;
    }

    if (createResult.value.status === 'duplicate') {
      duplicates++;
      continue;
    }

    // Event was created - increment the daily aggregate
    const aggregateResult = await usageAggregateRepository.incrementAggregate(fullEvent);
    if (isErr(aggregateResult)) {
      logger.error(
        { eventId: input.eventId, error: aggregateResult.error },
        'Failed to increment daily aggregate (event was still stored)',
      );
    }

    accepted++;
  }

  logger.info(
    { accepted, duplicates, rejected: rejected.length, total: events.length },
    'Usage event ingestion complete',
  );

  // In non-production, fail-fast at end-of-loop so good events in the batch are
  // still processed before the throw. This preserves the dev signal while not
  // dropping work mid-batch.
  if (process.env['NODE_ENV'] !== 'production' && pricingMissingEvents.length > 0) {
    const summary = pricingMissingEvents
      .map((e) => `${e.provider}/${e.model}`)
      .join(', ');
    throw new Error(
      `Pricing missing for unknown model(s): ${summary}. Add an entry to llm-pricing or mark as unsupported.`,
    );
  }

  return { accepted, duplicates, rejected };
}

interface ResolvedCost {
  billedUsd: number;
  providerReportedUsd: number | null;
  calculatedUsd: number | null;
  pricingSource: 'provider_reported' | 'calculated' | 'missing';
}

async function resolveCost(
  input: UsageEventInput,
  pricingCache: PricingCache,
  logger: Logger,
): Promise<ResolvedCost> {
  if (input.cost.pricingSource === 'provider_reported' && input.cost.providerReportedUsd !== null) {
    return {
      billedUsd: Math.max(0, input.cost.providerReportedUsd),
      providerReportedUsd: input.cost.providerReportedUsd,
      calculatedUsd: null,
      pricingSource: 'provider_reported',
    };
  }

  // pricingSource === 'pending' (or provider_reported with null USD)
  const pricing = await pricingCache.getModelPricing(input.request.provider, input.request.model, logger);

  if (pricing !== null) {
    const calculatedUsd = calculateCost(input.request.provider, input.usage, pricing);
    return {
      billedUsd: calculatedUsd,
      providerReportedUsd: null,
      calculatedUsd,
      pricingSource: 'calculated',
    };
  }

  logger.warn(
    { provider: input.request.provider, model: input.request.model, _skipSentry: true },
    'No pricing found for model — emitting pricingSource:missing',
  );
  if (process.env['NODE_ENV'] !== 'production') {
    throw new Error(
      `Pricing missing for unknown model ${input.request.provider}/${input.request.model}. Add an entry to llm-pricing or mark as unsupported.`,
    );
  }
  return {
    billedUsd: 0,
    providerReportedUsd: null,
    calculatedUsd: 0,
    pricingSource: 'missing',
  };
}

function enrichEvent(
  input: UsageEventInput,
  receivedAt: string,
  ingress: 'internal' | 'orchestrator_webhook',
  cost: ResolvedCost,
): UsageEvent {
  return {
    schemaVersion: 1,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    receivedAt,
    ingress,
    owner: input.owner,
    source: input.source,
    request: input.request,
    usage: input.usage,
    cost,
    correlation: input.correlation,
    error: input.error,
  };
}
