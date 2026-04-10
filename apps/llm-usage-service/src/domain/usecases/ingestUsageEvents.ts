import type { Logger } from '@intexuraos/common-core';
import { isErr } from '@intexuraos/common-core';
import type { UsageEventInput, UsageIngestResponse, RejectedEvent, UsageEvent } from '../models/usageEvent.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';

export interface IngestUsageEventsDeps {
  logger: Logger;
  usageEventRepository: UsageEventRepository;
  usageAggregateRepository: UsageAggregateRepository;
}

export async function ingestUsageEvents(
  deps: IngestUsageEventsDeps,
  events: UsageEventInput[],
  ingress: 'internal' | 'orchestrator_webhook',
): Promise<UsageIngestResponse> {
  const { logger, usageEventRepository, usageAggregateRepository } = deps;

  let accepted = 0;
  let duplicates = 0;
  const rejected: RejectedEvent[] = [];

  const receivedAt = new Date().toISOString();

  for (let i = 0; i < events.length; i++) {
    const input = events[i];
    if (input === undefined) {
      continue;
    }

    // Structural validation (schemaVersion, field presence/types/enums, additionalProperties)
    // is performed by the Fastify route schema (UsageEventInput / OrchestratorUsageEventInput)
    // before this use case runs. Malformed events never reach here; the only rejection path
    // remaining is Firestore createEvent failures below.

    const fullEvent: UsageEvent = {
      ...input,
      receivedAt,
      ingress,
    };

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

  return { accepted, duplicates, rejected };
}
