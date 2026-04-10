import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import { ingestUsageEvents } from '../../../domain/usecases/ingestUsageEvents.js';
import { FakeUsageEventRepository } from '../../fakeUsageEventRepository.js';
import { FakeUsageAggregateRepository } from '../../fakeUsageAggregateRepository.js';
import { createTestEventInput } from '../../helpers.js';
import type { UsageEventInput } from '../../../domain/models/usageEvent.js';

describe('ingestUsageEvents', () => {
  let eventRepo: FakeUsageEventRepository;
  let aggregateRepo: FakeUsageAggregateRepository;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never;

  beforeEach(() => {
    eventRepo = new FakeUsageEventRepository();
    aggregateRepo = new FakeUsageAggregateRepository();
  });

  it('accepts valid events', async () => {
    const events = [createTestEventInput({ eventId: 'evt_1' })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.rejected).toHaveLength(0);
  });

  it('detects duplicate events', async () => {
    const events = [
      createTestEventInput({ eventId: 'evt_dup' }),
      createTestEventInput({ eventId: 'evt_dup' }),
    ];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it('rejects events with invalid schemaVersion', async () => {
    const events = [{ ...createTestEventInput(), schemaVersion: 2 as unknown as 1 }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SCHEMA_VERSION');
  });

  it('rejects events with empty eventId', async () => {
    const events = [createTestEventInput({ eventId: '' })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_EVENT_ID');
  });

  it('rejects events with empty occurredAt', async () => {
    const events = [createTestEventInput({ occurredAt: '' })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OCCURRED_AT');
  });

  it('rejects events with missing owner', async () => {
    const events = [{ ...createTestEventInput(), owner: null } as unknown as UsageEventInput];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OWNER');
  });

  it('rejects events with invalid owner type', async () => {
    const events = [createTestEventInput({ owner: { type: 'invalid' as 'user', id: 'x' } })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OWNER_TYPE');
  });

  it('rejects events with empty owner id', async () => {
    const events = [createTestEventInput({ owner: { type: 'user', id: '' } })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OWNER_ID');
  });

  it('rejects events with missing source', async () => {
    const events = [{ ...createTestEventInput(), source: undefined } as unknown as UsageEventInput];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SOURCE');
  });

  it('rejects events with empty source.service', async () => {
    const events = [createTestEventInput({
      source: { service: '', component: 'x', client: 'y', environment: 'dev' },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SOURCE_SERVICE');
  });

  it('rejects events with empty source.component', async () => {
    const events = [createTestEventInput({
      source: { service: 'svc', component: '', client: 'y', environment: 'dev' },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SOURCE_COMPONENT');
  });

  it('rejects events with empty source.client', async () => {
    const events = [createTestEventInput({
      source: { service: 'svc', component: 'comp', client: '', environment: 'dev' },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SOURCE_CLIENT');
  });

  it('rejects events with invalid source.environment', async () => {
    const events = [createTestEventInput({
      source: { service: 'svc', component: 'comp', client: 'web', environment: 'staging' as 'dev' },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SOURCE_ENVIRONMENT');
  });

  it('rejects events with missing request', async () => {
    const events = [{ ...createTestEventInput(), request: null } as unknown as UsageEventInput];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_REQUEST');
  });

  it('rejects events with invalid provider', async () => {
    const events = [createTestEventInput({
      request: { provider: 'invalid' as typeof LlmProviders.OpenAI, model: 'x', operation: 'generate', success: true, durationMs: 100 },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_PROVIDER');
  });

  it('rejects events with empty model', async () => {
    const events = [createTestEventInput({
      request: { provider: LlmProviders.OpenAI, model: '', operation: 'generate', success: true, durationMs: 100 },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_MODEL');
  });

  it('rejects events with invalid operation', async () => {
    const events = [createTestEventInput({
      request: { provider: LlmProviders.OpenAI, model: 'gpt-4o', operation: 'invalid' as 'generate', success: true, durationMs: 100 },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OPERATION');
  });

  it('rejects events with non-boolean success', async () => {
    const events = [createTestEventInput({
      request: { provider: LlmProviders.OpenAI, model: 'gpt-4o', operation: 'generate', success: 'true' as unknown as boolean, durationMs: 100 },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SUCCESS');
  });

  it('rejects events with negative durationMs', async () => {
    const events = [createTestEventInput({
      request: { provider: LlmProviders.OpenAI, model: 'gpt-4o', operation: 'generate', success: true, durationMs: -1 },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_DURATION');
  });

  it('rejects events with missing usage', async () => {
    const events = [{ ...createTestEventInput(), usage: null } as unknown as UsageEventInput];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_USAGE');
  });

  it('rejects events with negative inputTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, inputTokens: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_INPUT_TOKENS');
  });

  it('rejects events with negative outputTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, outputTokens: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OUTPUT_TOKENS');
  });

  it('rejects events with negative totalTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, totalTokens: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_TOTAL_TOKENS');
  });

  it('rejects events with missing cost', async () => {
    const events = [{ ...createTestEventInput(), cost: undefined } as unknown as UsageEventInput];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_COST');
  });

  it('rejects events with negative billedUsd', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, cost: { ...input.cost, billedUsd: -0.01 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_BILLED_USD');
  });

  it('rejects events with invalid pricingSource', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, cost: { ...input.cost, pricingSource: 'invalid' as 'calculated' } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_PRICING_SOURCE');
  });

  it('rejects events with missing correlation', async () => {
    const events = [{ ...createTestEventInput(), correlation: null } as unknown as UsageEventInput];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_CORRELATION');
  });

  it('handles repository create failure', async () => {
    eventRepo.setFailure({ code: 'FIRESTORE_ERROR', message: 'connection failed' });
    const events = [createTestEventInput({ eventId: 'evt_fail' })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('FIRESTORE_ERROR');
  });

  it('handles aggregate increment failure gracefully (event still stored)', async () => {
    aggregateRepo.setFailure({ code: 'AGG_ERROR', message: 'aggregate failed' });
    const events = [createTestEventInput({ eventId: 'evt_agg_fail' })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    // Event was still accepted even though aggregation failed
    expect(result.accepted).toBe(1);
  });

  it('skips undefined events in the array', async () => {
    const events = [undefined as unknown as UsageEventInput, createTestEventInput({ eventId: 'evt_ok' })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.accepted).toBe(1);
  });

  it('rejects events with non-string eventId', async () => {
    const events = [{ ...createTestEventInput(), eventId: 123 as unknown as string }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_EVENT_ID');
  });

  it('rejects events with non-string occurredAt', async () => {
    const events = [{ ...createTestEventInput(), occurredAt: 123 as unknown as string }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OCCURRED_AT');
  });

  it('rejects events with non-string owner.id', async () => {
    const events = [createTestEventInput({ owner: { type: 'user', id: 123 as unknown as string } })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OWNER_ID');
  });

  it('rejects events with non-string source.service', async () => {
    const events = [createTestEventInput({
      source: { service: 123 as unknown as string, component: 'c', client: 'web', environment: 'dev' },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SOURCE_SERVICE');
  });

  it('rejects events with non-string source.component', async () => {
    const events = [createTestEventInput({
      source: { service: 'svc', component: 123 as unknown as string, client: 'web', environment: 'dev' },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SOURCE_COMPONENT');
  });

  it('rejects events with non-string source.client', async () => {
    const events = [createTestEventInput({
      source: { service: 'svc', component: 'comp', client: 123 as unknown as string, environment: 'dev' },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_SOURCE_CLIENT');
  });

  it('rejects events with non-string request.model', async () => {
    const events = [createTestEventInput({
      request: { provider: LlmProviders.OpenAI, model: 123 as unknown as string, operation: 'generate', success: true, durationMs: 100 },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_MODEL');
  });

  it('rejects events with non-number durationMs', async () => {
    const events = [createTestEventInput({
      request: { provider: LlmProviders.OpenAI, model: 'gpt-4o', operation: 'generate', success: true, durationMs: 'fast' as unknown as number },
    })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_DURATION');
  });

  it('rejects events with non-number inputTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, inputTokens: 'many' as unknown as number } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_INPUT_TOKENS');
  });

  it('rejects events with non-number outputTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, outputTokens: 'many' as unknown as number } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OUTPUT_TOKENS');
  });

  it('rejects events with non-number totalTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, totalTokens: 'many' as unknown as number } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_TOTAL_TOKENS');
  });

  it('rejects events with invalid occurredAt timestamp', async () => {
    const events = [createTestEventInput({ occurredAt: 'not-a-date' })];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_OCCURRED_AT');
    expect(result.rejected[0]?.message).toBe('occurredAt must be a valid ISO timestamp');
  });

  it('rejects events with negative cacheReadTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, cacheReadTokens: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_CACHE_READ_TOKENS');
  });

  it('rejects events with negative cacheWriteTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, cacheWriteTokens: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_CACHE_WRITE_TOKENS');
  });

  it('rejects events with negative cachedTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, cachedTokens: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_CACHED_TOKENS');
  });

  it('rejects events with negative reasoningTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, reasoningTokens: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_REASONING_TOKENS');
  });

  it('rejects events with negative thinkingTokens', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, thinkingTokens: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_THINKING_TOKENS');
  });

  it('rejects events with negative webSearchCalls', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, webSearchCalls: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_WEB_SEARCH_CALLS');
  });

  it('rejects events with negative imageCount', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, usage: { ...input.usage, imageCount: -1 } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_IMAGE_COUNT');
  });

  it('rejects events with non-number billedUsd', async () => {
    const input = createTestEventInput();
    const events = [{ ...input, cost: { ...input.cost, billedUsd: 'cheap' as unknown as number } }];
    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      events,
      'internal',
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe('INVALID_BILLED_USD');
  });
});
