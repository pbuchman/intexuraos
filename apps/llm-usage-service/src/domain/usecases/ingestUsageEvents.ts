import type { Logger } from '@intexuraos/common-core';
import { isErr } from '@intexuraos/common-core';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { UsageEventInput, UsageIngestResponse, RejectedEvent, UsageEvent } from '../models/usageEvent.js';
import type { UsageEventRepository } from '../repositories/usageEventRepository.js';
import type { UsageAggregateRepository } from '../repositories/usageAggregateRepository.js';

const VALID_PROVIDERS = [LlmProviders.Google, LlmProviders.OpenAI, LlmProviders.Anthropic, LlmProviders.Perplexity, LlmProviders.OpenRouter] as const;
const VALID_OPERATIONS = [
  'research', 'generate', 'image_generation', 'tool_calling',
  'visualization_insights', 'visualization_vegalite', 'other',
] as const;
const VALID_OWNER_TYPES = ['user', 'system'] as const;
const VALID_ENVIRONMENTS = ['dev', 'prod', 'test'] as const;
const VALID_PRICING_SOURCES = ['provider_reported', 'calculated', 'mixed', 'external'] as const;

/**
 * Validates untrusted JSON input that has been cast to UsageEventInput.
 * The runtime checks guard against malformed payloads that bypass TypeScript's
 * compile-time guarantees.
 */
function validateEvent(typedInput: UsageEventInput, index: number): RejectedEvent | null {
  // Cast to unknown to perform runtime validation on untrusted JSON
  const input = typedInput as unknown as Record<string, unknown>;

  if (input['schemaVersion'] !== 1) {
    return { index, code: 'INVALID_SCHEMA_VERSION', message: 'schemaVersion must be 1' };
  }

  if (typeof input['eventId'] !== 'string' || input['eventId'].length === 0) {
    return { index, code: 'INVALID_EVENT_ID', message: 'eventId is required and must be a non-empty string' };
  }

  if (typeof input['occurredAt'] !== 'string' || input['occurredAt'].length === 0) {
    return { index, code: 'INVALID_OCCURRED_AT', message: 'occurredAt is required and must be a non-empty ISO timestamp' };
  }

  const parsedDate = new Date(input['occurredAt']);
  if (Number.isNaN(parsedDate.getTime())) {
    return { index, code: 'INVALID_OCCURRED_AT', message: 'occurredAt must be a valid ISO timestamp' };
  }

  // Validate owner
  const owner = input['owner'] as Record<string, unknown> | undefined | null;
  if (owner === undefined || owner === null) {
    return { index, code: 'INVALID_OWNER', message: 'owner is required' };
  }
  if (!VALID_OWNER_TYPES.includes(owner['type'] as typeof VALID_OWNER_TYPES[number])) {
    return { index, code: 'INVALID_OWNER_TYPE', message: `owner.type must be one of: ${VALID_OWNER_TYPES.join(', ')}` };
  }
  if (typeof owner['id'] !== 'string' || owner['id'].length === 0) {
    return { index, code: 'INVALID_OWNER_ID', message: 'owner.id is required and must be a non-empty string' };
  }

  // Validate source
  const source = input['source'] as Record<string, unknown> | undefined | null;
  if (source === undefined || source === null) {
    return { index, code: 'INVALID_SOURCE', message: 'source is required' };
  }
  if (typeof source['service'] !== 'string' || source['service'].length === 0) {
    return { index, code: 'INVALID_SOURCE_SERVICE', message: 'source.service is required' };
  }
  if (typeof source['component'] !== 'string' || source['component'].length === 0) {
    return { index, code: 'INVALID_SOURCE_COMPONENT', message: 'source.component is required' };
  }
  if (typeof source['client'] !== 'string' || source['client'].length === 0) {
    return { index, code: 'INVALID_SOURCE_CLIENT', message: 'source.client is required' };
  }
  if (!VALID_ENVIRONMENTS.includes(source['environment'] as typeof VALID_ENVIRONMENTS[number])) {
    return { index, code: 'INVALID_SOURCE_ENVIRONMENT', message: `source.environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}` };
  }

  // Validate request
  const request = input['request'] as Record<string, unknown> | undefined | null;
  if (request === undefined || request === null) {
    return { index, code: 'INVALID_REQUEST', message: 'request is required' };
  }
  if (!VALID_PROVIDERS.includes(request['provider'] as typeof VALID_PROVIDERS[number])) {
    return { index, code: 'INVALID_PROVIDER', message: `request.provider must be one of: ${VALID_PROVIDERS.join(', ')}` };
  }
  if (typeof request['model'] !== 'string' || request['model'].length === 0) {
    return { index, code: 'INVALID_MODEL', message: 'request.model is required' };
  }
  if (!VALID_OPERATIONS.includes(request['operation'] as typeof VALID_OPERATIONS[number])) {
    return { index, code: 'INVALID_OPERATION', message: `request.operation must be one of: ${VALID_OPERATIONS.join(', ')}` };
  }
  if (typeof request['success'] !== 'boolean') {
    return { index, code: 'INVALID_SUCCESS', message: 'request.success must be a boolean' };
  }
  if (typeof request['durationMs'] !== 'number' || request['durationMs'] < 0) {
    return { index, code: 'INVALID_DURATION', message: 'request.durationMs must be a non-negative number' };
  }

  // Validate usage
  const usage = input['usage'] as Record<string, unknown> | undefined | null;
  if (usage === undefined || usage === null) {
    return { index, code: 'INVALID_USAGE', message: 'usage is required' };
  }
  if (typeof usage['inputTokens'] !== 'number' || usage['inputTokens'] < 0) {
    return { index, code: 'INVALID_INPUT_TOKENS', message: 'usage.inputTokens must be a non-negative number' };
  }
  if (typeof usage['outputTokens'] !== 'number' || usage['outputTokens'] < 0) {
    return { index, code: 'INVALID_OUTPUT_TOKENS', message: 'usage.outputTokens must be a non-negative number' };
  }
  if (typeof usage['totalTokens'] !== 'number' || usage['totalTokens'] < 0) {
    return { index, code: 'INVALID_TOTAL_TOKENS', message: 'usage.totalTokens must be a non-negative number' };
  }
  if (typeof usage['cacheReadTokens'] !== 'number' || usage['cacheReadTokens'] < 0) {
    return { index, code: 'INVALID_CACHE_READ_TOKENS', message: 'usage.cacheReadTokens must be >= 0' };
  }
  if (typeof usage['cacheWriteTokens'] !== 'number' || usage['cacheWriteTokens'] < 0) {
    return { index, code: 'INVALID_CACHE_WRITE_TOKENS', message: 'usage.cacheWriteTokens must be >= 0' };
  }
  if (typeof usage['cachedTokens'] !== 'number' || usage['cachedTokens'] < 0) {
    return { index, code: 'INVALID_CACHED_TOKENS', message: 'usage.cachedTokens must be >= 0' };
  }
  if (typeof usage['reasoningTokens'] !== 'number' || usage['reasoningTokens'] < 0) {
    return { index, code: 'INVALID_REASONING_TOKENS', message: 'usage.reasoningTokens must be >= 0' };
  }
  if (typeof usage['thinkingTokens'] !== 'number' || usage['thinkingTokens'] < 0) {
    return { index, code: 'INVALID_THINKING_TOKENS', message: 'usage.thinkingTokens must be >= 0' };
  }
  if (typeof usage['webSearchCalls'] !== 'number' || usage['webSearchCalls'] < 0) {
    return { index, code: 'INVALID_WEB_SEARCH_CALLS', message: 'usage.webSearchCalls must be >= 0' };
  }
  if (typeof usage['imageCount'] !== 'number' || usage['imageCount'] < 0) {
    return { index, code: 'INVALID_IMAGE_COUNT', message: 'usage.imageCount must be >= 0' };
  }

  // Validate cost
  const cost = input['cost'] as Record<string, unknown> | undefined | null;
  if (cost === undefined || cost === null) {
    return { index, code: 'INVALID_COST', message: 'cost is required' };
  }
  if (typeof cost['billedUsd'] !== 'number' || cost['billedUsd'] < 0) {
    return { index, code: 'INVALID_BILLED_USD', message: 'cost.billedUsd must be a non-negative number' };
  }
  if (!VALID_PRICING_SOURCES.includes(cost['pricingSource'] as typeof VALID_PRICING_SOURCES[number])) {
    return { index, code: 'INVALID_PRICING_SOURCE', message: `cost.pricingSource must be one of: ${VALID_PRICING_SOURCES.join(', ')}` };
  }

  // Validate correlation
  const correlation = input['correlation'];
  if (correlation === undefined || correlation === null) {
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
