import type { Logger } from '@intexuraos/common-core';
import { isErr } from '@intexuraos/common-core';
import type { UsageEventInput, UsageIngestResponse, RejectedEvent, UsageEvent } from '../models/usageEvent.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';

const VALID_PROVIDERS = ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'] as const;
const VALID_OPERATIONS = [
  'research', 'generate', 'image_generation', 'tool_calling',
  'visualization_insights', 'visualization_vegalite', 'other',
] as const;
const VALID_OWNER_TYPES = ['user', 'system'] as const;
const VALID_ENVIRONMENTS = ['dev', 'prod', 'test'] as const;
const VALID_PRICING_SOURCES = ['provider_reported', 'calculated', 'mixed', 'external'] as const;

function validateEvent(input: UsageEventInput, index: number): RejectedEvent | null {
  if (input.schemaVersion !== 1) {
    return { index, code: 'INVALID_SCHEMA_VERSION', message: 'schemaVersion must be 1' };
  }

  if (typeof input.eventId !== 'string' || input.eventId.length === 0) {
    return { index, code: 'INVALID_EVENT_ID', message: 'eventId is required and must be a non-empty string' };
  }

  if (typeof input.occurredAt !== 'string' || input.occurredAt.length === 0) {
    return { index, code: 'INVALID_OCCURRED_AT', message: 'occurredAt is required and must be a non-empty ISO timestamp' };
  }

  // Validate owner
  if (input.owner === undefined || input.owner === null) {
    return { index, code: 'INVALID_OWNER', message: 'owner is required' };
  }
  if (!VALID_OWNER_TYPES.includes(input.owner.type)) {
    return { index, code: 'INVALID_OWNER_TYPE', message: `owner.type must be one of: ${VALID_OWNER_TYPES.join(', ')}` };
  }
  if (typeof input.owner.id !== 'string' || input.owner.id.length === 0) {
    return { index, code: 'INVALID_OWNER_ID', message: 'owner.id is required and must be a non-empty string' };
  }

  // Validate source
  if (input.source === undefined || input.source === null) {
    return { index, code: 'INVALID_SOURCE', message: 'source is required' };
  }
  if (typeof input.source.service !== 'string' || input.source.service.length === 0) {
    return { index, code: 'INVALID_SOURCE_SERVICE', message: 'source.service is required' };
  }
  if (typeof input.source.component !== 'string' || input.source.component.length === 0) {
    return { index, code: 'INVALID_SOURCE_COMPONENT', message: 'source.component is required' };
  }
  if (typeof input.source.client !== 'string' || input.source.client.length === 0) {
    return { index, code: 'INVALID_SOURCE_CLIENT', message: 'source.client is required' };
  }
  if (!VALID_ENVIRONMENTS.includes(input.source.environment)) {
    return { index, code: 'INVALID_SOURCE_ENVIRONMENT', message: `source.environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}` };
  }

  // Validate request
  if (input.request === undefined || input.request === null) {
    return { index, code: 'INVALID_REQUEST', message: 'request is required' };
  }
  if (!VALID_PROVIDERS.includes(input.request.provider)) {
    return { index, code: 'INVALID_PROVIDER', message: `request.provider must be one of: ${VALID_PROVIDERS.join(', ')}` };
  }
  if (typeof input.request.model !== 'string' || input.request.model.length === 0) {
    return { index, code: 'INVALID_MODEL', message: 'request.model is required' };
  }
  if (!VALID_OPERATIONS.includes(input.request.operation)) {
    return { index, code: 'INVALID_OPERATION', message: `request.operation must be one of: ${VALID_OPERATIONS.join(', ')}` };
  }
  if (typeof input.request.success !== 'boolean') {
    return { index, code: 'INVALID_SUCCESS', message: 'request.success must be a boolean' };
  }
  if (typeof input.request.durationMs !== 'number' || input.request.durationMs < 0) {
    return { index, code: 'INVALID_DURATION', message: 'request.durationMs must be a non-negative number' };
  }

  // Validate usage
  if (input.usage === undefined || input.usage === null) {
    return { index, code: 'INVALID_USAGE', message: 'usage is required' };
  }
  if (typeof input.usage.inputTokens !== 'number' || input.usage.inputTokens < 0) {
    return { index, code: 'INVALID_INPUT_TOKENS', message: 'usage.inputTokens must be a non-negative number' };
  }
  if (typeof input.usage.outputTokens !== 'number' || input.usage.outputTokens < 0) {
    return { index, code: 'INVALID_OUTPUT_TOKENS', message: 'usage.outputTokens must be a non-negative number' };
  }
  if (typeof input.usage.totalTokens !== 'number' || input.usage.totalTokens < 0) {
    return { index, code: 'INVALID_TOTAL_TOKENS', message: 'usage.totalTokens must be a non-negative number' };
  }

  // Validate cost
  if (input.cost === undefined || input.cost === null) {
    return { index, code: 'INVALID_COST', message: 'cost is required' };
  }
  if (typeof input.cost.billedUsd !== 'number' || input.cost.billedUsd < 0) {
    return { index, code: 'INVALID_BILLED_USD', message: 'cost.billedUsd must be a non-negative number' };
  }
  if (!VALID_PRICING_SOURCES.includes(input.cost.pricingSource)) {
    return { index, code: 'INVALID_PRICING_SOURCE', message: `cost.pricingSource must be one of: ${VALID_PRICING_SOURCES.join(', ')}` };
  }

  // Validate correlation
  if (input.correlation === undefined || input.correlation === null) {
    return { index, code: 'INVALID_CORRELATION', message: 'correlation is required' };
  }

  return null;
}

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

    const validationError = validateEvent(input, i);
    if (validationError !== null) {
      rejected.push(validationError);
      continue;
    }

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
