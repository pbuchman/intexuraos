import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ingestUsageEvents } from '../../../domain/usecases/ingestUsageEvents.js';
import { FakeUsageEventRepository } from '../../fakeUsageEventRepository.js';
import { FakeUsageAggregateRepository } from '../../fakeUsageAggregateRepository.js';
import { createTestEventInput } from '../../helpers.js';
import type { UsageEventInput } from '../../../domain/models/usageEvent.js';

/**
 * Use-case-layer tests for `ingestUsageEvents`.
 *
 * As of the strict-schema refactor, structural validation (schemaVersion, field
 * presence/types/enums, additionalProperties, orchestrator constraint) is performed
 * by the Fastify route schemas `UsageEventInput` / `OrchestratorUsageEventInput`
 * BEFORE this use case runs. Malformed events never reach the use case, so the
 * ~46 field-level rejection tests that previously lived in this file have been
 * deleted — they exercised branches of `validateEvent()` that no longer exist.
 *
 * The tests below cover the remaining use-case responsibilities:
 *   1. Happy path: valid events are stored and aggregates incremented.
 *   2. Deduplication: same eventId is counted as `duplicate`, not `accepted`.
 *   3. Repository failures: Firestore `createEvent` errors are surfaced as rejected entries.
 *   4. Aggregate failures: aggregate increment errors do not block event storage.
 *   5. Sparse arrays: `undefined` holes in the events array are skipped.
 *   6. Mixed batch: valid + duplicate events are handled correctly in a single call.
 *
 * Field-level rejection behavior is now tested at the route layer in
 * `src/__tests__/routes/internalUsageRoutes.test.ts` and
 * `src/__tests__/routes/webhookUsageRoutes.test.ts`.
 */
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

  it('detects duplicate events and does not double-increment aggregate', async () => {
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
    expect(aggregateRepo.getIncrementCallCount()).toBe(1);
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

  it('handles mixed batch (valid + duplicate)', async () => {
    // Pre-seed the duplicate
    await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      [createTestEventInput({ eventId: 'evt_dup' })],
      'internal',
    );

    const preIncrementCount = aggregateRepo.getIncrementCallCount();

    const result = await ingestUsageEvents(
      { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo },
      [
        createTestEventInput({ eventId: 'evt_new' }), // valid
        createTestEventInput({ eventId: 'evt_dup' }), // duplicate (pre-seeded above)
      ],
      'internal',
    );

    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.rejected).toHaveLength(0);
    // Only the new valid event should have incremented the aggregate
    expect(aggregateRepo.getIncrementCallCount()).toBe(preIncrementCount + 1);
  });
});
