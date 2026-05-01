import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { LlmModels } from '@intexuraos/llm-contract';
import { ingestUsageEvents } from '../../../domain/usecases/ingestUsageEvents.js';
import { FakeUsageEventRepository } from '../../fakeUsageEventRepository.js';
import { FakeUsageAggregateRepository } from '../../fakeUsageAggregateRepository.js';
import { FakePricingCache } from '../../fakePricingCache.js';
import { createTestEventInput } from '../../helpers.js';
import type { UsageEventInput } from '../../../domain/models/usageEvent.js';

/**
 * Use-case-layer tests for `ingestUsageEvents`.
 *
 * Tests cover:
 *   1. V1 backward compatibility (happy path, dedup, repo failure, aggregate failure, sparse arrays, mixed batch)
 *   2. V2 pending pricing source with pricing found (calculated cost)
 *   3. V2 pending pricing source with unknown model (default to 0)
 *   4. V2 provider_reported pricing source
 *   5. V2 provider_reported with negative providerReportedUsd (clamping)
 */
describe('ingestUsageEvents', () => {
  let eventRepo: FakeUsageEventRepository;
  let aggregateRepo: FakeUsageAggregateRepository;
  let pricingCache: FakePricingCache;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never;

  const anthropicPricing: ModelPricing = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
  };

  beforeEach(() => {
    eventRepo = new FakeUsageEventRepository();
    aggregateRepo = new FakeUsageAggregateRepository();
    pricingCache = new FakePricingCache();
  });

  function makeDeps(): { logger: typeof logger; usageEventRepository: FakeUsageEventRepository; usageAggregateRepository: FakeUsageAggregateRepository; pricingCache: FakePricingCache } {
    return { logger, usageEventRepository: eventRepo, usageAggregateRepository: aggregateRepo, pricingCache };
  }

  // ---------------------------------------------------------------------------
  // Happy path and failure handling
  // ---------------------------------------------------------------------------
  describe('happy path and failure handling', () => {
    it('accepts valid events', async () => {
      const events = [createTestEventInput({ eventId: 'evt_1' })];
      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.accepted).toBe(1);
      expect(result.duplicates).toBe(0);
      expect(result.rejected).toHaveLength(0);
    });

    it('detects duplicate events and does not double-increment aggregate', async () => {
      const events = [
        createTestEventInput({ eventId: 'evt_dup' }),
        createTestEventInput({ eventId: 'evt_dup' }),
      ];
      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.accepted).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(aggregateRepo.getIncrementCallCount()).toBe(1);
    });

    it('handles repository create failure', async () => {
      eventRepo.setFailure({ code: 'FIRESTORE_ERROR', message: 'connection failed' });
      const events = [createTestEventInput({ eventId: 'evt_fail' })];
      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]?.code).toBe('FIRESTORE_ERROR');
    });

    it('handles aggregate increment failure gracefully (event still stored)', async () => {
      aggregateRepo.setFailure({ code: 'AGG_ERROR', message: 'aggregate failed' });
      const events = [createTestEventInput({ eventId: 'evt_agg_fail' })];
      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.accepted).toBe(1);
    });

    it('skips undefined events in the array', async () => {
      const events = [undefined as unknown as UsageEventInput, createTestEventInput({ eventId: 'evt_ok' })];
      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.accepted).toBe(1);
    });

    it('handles mixed batch (valid + duplicate)', async () => {
      await ingestUsageEvents(makeDeps(), [createTestEventInput({ eventId: 'evt_dup' })], 'internal');
      const preIncrementCount = aggregateRepo.getIncrementCallCount();

      const result = await ingestUsageEvents(
        makeDeps(),
        [
          createTestEventInput({ eventId: 'evt_new' }),
          createTestEventInput({ eventId: 'evt_dup' }),
        ],
        'internal',
      );

      expect(result.accepted).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(result.rejected).toHaveLength(0);
      expect(aggregateRepo.getIncrementCallCount()).toBe(preIncrementCount + 1);
    });

  });

  // ---------------------------------------------------------------------------
  // V2 events
  // ---------------------------------------------------------------------------
  describe('v2 events', () => {
    it('enriches pending events with calculated cost when pricing is found', async () => {
      pricingCache.setPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', anthropicPricing);

      const events = [createTestEventInput({
        eventId: 'evt_v2_pending',
        cost: { providerReportedUsd: null, pricingSource: 'pending' },
      })];

      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.accepted).toBe(1);

      const stored = eventRepo.getStoredEvents();
      expect(stored).toHaveLength(1);
      const event = stored[0];
      expect(event).toBeDefined();
      expect(event?.schemaVersion).toBe(1);
      expect(event?.cost.pricingSource).toBe('calculated');
      expect(event?.cost.providerReportedUsd).toBeNull();
      expect(event?.cost.calculatedUsd).toBeGreaterThan(0);
      expect(event?.cost.billedUsd).toBe(event?.cost.calculatedUsd);
    });

    it('emits pricingSource:missing and billedUsd:0 for unknown models in production', async () => {
      // FakePricingCache seeds the default fixture model; clear it so the
      // unknown-model path is exercised regardless of which model the
      // fixture defaults to.
      pricingCache.invalidate();
      const originalNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';
      try {
        const events = [createTestEventInput({
          eventId: 'evt_v2_unknown',
          request: {
            provider: LlmProviders.Anthropic,
            model: 'claude-unknown-v99',
            operation: 'generate',
            success: true,
            durationMs: 1500,
          },
          cost: { providerReportedUsd: null, pricingSource: 'pending' },
        })];

        const result = await ingestUsageEvents(makeDeps(), events, 'internal');

        expect(result.accepted).toBe(1);

        const stored = eventRepo.getStoredEvents();
        expect(stored).toHaveLength(1);
        const event = stored[0];
        expect(event?.cost.billedUsd).toBe(0);
        expect(event?.cost.calculatedUsd).toBe(0);
        expect(event?.cost.pricingSource).toBe('missing');
        expect(event?.cost.providerReportedUsd).toBeNull();
      } finally {
        if (originalNodeEnv === undefined) {
          delete process.env['NODE_ENV'];
        } else {
          process.env['NODE_ENV'] = originalNodeEnv;
        }
      }
    });

    it('fails fast in dev when an unknown model is ingested', async () => {
      pricingCache.invalidate();
      const originalNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';
      try {
        const events = [createTestEventInput({
          eventId: 'evt_v2_unknown_dev',
          request: {
            provider: LlmProviders.Anthropic,
            model: 'claude-unknown-v99',
            operation: 'generate',
            success: true,
            durationMs: 1500,
          },
          cost: { providerReportedUsd: null, pricingSource: 'pending' },
        })];

        await expect(ingestUsageEvents(makeDeps(), events, 'internal')).rejects.toThrow(
          /Pricing missing for unknown model/i,
        );
      } finally {
        if (originalNodeEnv === undefined) {
          delete process.env['NODE_ENV'];
        } else {
          process.env['NODE_ENV'] = originalNodeEnv;
        }
      }
    });

    it('uses provider_reported cost when pricingSource is provider_reported and providerReportedUsd is non-null', async () => {
      const events = [createTestEventInput({
        eventId: 'evt_v2_reported',
        cost: { providerReportedUsd: 0.0042, pricingSource: 'provider_reported' },
      })];

      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.accepted).toBe(1);

      const stored = eventRepo.getStoredEvents();
      expect(stored).toHaveLength(1);
      const event = stored[0];
      expect(event?.cost.billedUsd).toBe(0.0042);
      expect(event?.cost.providerReportedUsd).toBe(0.0042);
      expect(event?.cost.calculatedUsd).toBeNull();
      expect(event?.cost.pricingSource).toBe('provider_reported');
    });

    it('clamps negative providerReportedUsd to 0 for billedUsd', async () => {
      const events = [createTestEventInput({
        eventId: 'evt_v2_negative',
        cost: { providerReportedUsd: -0.005, pricingSource: 'provider_reported' },
      })];

      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.accepted).toBe(1);

      const stored = eventRepo.getStoredEvents();
      const event = stored[0];
      expect(event?.cost.billedUsd).toBe(0);
      expect(event?.cost.providerReportedUsd).toBe(-0.005);
      expect(event?.cost.pricingSource).toBe('provider_reported');
    });

    it('falls back to calculated pricing when provider_reported has null USD', async () => {
      pricingCache.setPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', anthropicPricing);

      const events = [createTestEventInput({
        eventId: 'evt_v2_reported_null',
        cost: { providerReportedUsd: null, pricingSource: 'provider_reported' },
      })];

      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.accepted).toBe(1);

      const stored = eventRepo.getStoredEvents();
      const event = stored[0];
      expect(event?.cost.pricingSource).toBe('calculated');
      expect(event?.cost.calculatedUsd).toBeGreaterThan(0);
      expect(event?.cost.billedUsd).toBe(event?.cost.calculatedUsd);
      expect(event?.cost.providerReportedUsd).toBeNull();
    });

    it('calculates a non-zero cost for the new claude-sonnet-4-7 SKU', async () => {
      // Mirrors the migration 099 entry for claude-sonnet-4-7.
      pricingCache.setPricing(LlmProviders.Anthropic, LlmModels.ClaudeSonnet47, {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
      });

      const events = [createTestEventInput({
        eventId: 'evt_claude_4_7',
        request: {
          provider: LlmProviders.Anthropic,
          model: LlmModels.ClaudeSonnet47,
          operation: 'generate',
          success: true,
          durationMs: 1500,
        },
        cost: { providerReportedUsd: null, pricingSource: 'pending' },
      })];

      const result = await ingestUsageEvents(makeDeps(), events, 'internal');

      expect(result.accepted).toBe(1);
      const stored = eventRepo.getStoredEvents();
      const event = stored[0];
      expect(event?.cost.pricingSource).toBe('calculated');
      expect(event?.cost.calculatedUsd).toBeGreaterThan(0);
      expect(event?.cost.billedUsd).toBe(event?.cost.calculatedUsd);
    });

    it('stores v2 events as schemaVersion 1', async () => {
      pricingCache.setPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', anthropicPricing);

      const events = [createTestEventInput({ eventId: 'evt_v2_stored_v1' })];
      await ingestUsageEvents(makeDeps(), events, 'internal');

      const stored = eventRepo.getStoredEvents();
      expect(stored[0]?.schemaVersion).toBe(1);
    });

  });
});
