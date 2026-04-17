import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LlmProviders } from '@intexuraos/llm-contract';
import { buildServer } from '../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
import { FakeUsageEventRepository } from '../fakeUsageEventRepository.js';
import { FakeUsageAggregateRepository } from '../fakeUsageAggregateRepository.js';
import { FakePricingRepository } from '../fakePricingRepository.js';
import { FakePricingCache } from '../fakePricingCache.js';
import { createTestEventInput } from '../helpers.js';

describe('internalUsageRoutes', () => {
  let app: FastifyInstance;
  let eventRepo: FakeUsageEventRepository;
  let aggregateRepo: FakeUsageAggregateRepository;
  const AUTH_TOKEN = 'test-internal-token';

  beforeAll(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = AUTH_TOKEN;
    app = await buildServer();
    await app.ready();
  });

  beforeEach(() => {
    eventRepo = new FakeUsageEventRepository();
    aggregateRepo = new FakeUsageAggregateRepository();
    setServices({
      usageEventRepository: eventRepo,
      usageAggregateRepository: aggregateRepo,
      pricingRepository: new FakePricingRepository(),
      pricingCache: new FakePricingCache(),
      orchestratorSecret: 'test-secret',
    } satisfies ServiceContainer);
  });

  afterEach(() => {
    resetServices();
  });

  afterAll(async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    await app.close();
  });

  describe('POST /internal/usage/events', () => {
    it('returns 200 with ingest result for valid events', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          schemaVersion: 2,
          events: [createTestEventInput({ eventId: 'evt_test_1' })],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { accepted: number } };
      expect(body.success).toBe(true);
      expect(body.data.accepted).toBe(1);
    });

    it('accepts events with promptType in request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          schemaVersion: 2,
          events: [
            createTestEventInput({
              eventId: 'evt_prompt_type',
              request: {
                provider: LlmProviders.Anthropic,
                model: 'claude-sonnet-4-20250514',
                operation: 'generate',
                success: true,
                durationMs: 1500,
                promptType: 'plan-analysis',
              },
            }),
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { accepted: number } };
      expect(body.success).toBe(true);
      expect(body.data.accepted).toBe(1);

      // Verify promptType was stored
      const stored = eventRepo.getStoredEvents();
      expect(stored).toHaveLength(1);
      const event = stored[0];
      expect(event).toBeDefined();
      expect(event?.request.promptType).toBe('plan-analysis');
    });

    it('returns 401 for missing auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        payload: {
          schemaVersion: 2,
          events: [],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for invalid schemaVersion', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          schemaVersion: 3,
          events: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts v2 events and stores enriched cost in Firestore', async () => {
      const pricingCache = new FakePricingCache();
      pricingCache.setPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      });
      setServices({
        usageEventRepository: eventRepo,
        usageAggregateRepository: aggregateRepo,
        pricingRepository: new FakePricingRepository(),
        pricingCache,
        orchestratorSecret: 'test-secret',
      } satisfies ServiceContainer);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          schemaVersion: 2,
          events: [createTestEventInput({ eventId: 'evt_v2_1' })],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { accepted: number } };
      expect(body.success).toBe(true);
      expect(body.data.accepted).toBe(1);

      // Verify Firestore round-trip: stored event has enriched cost shape
      const stored = eventRepo.getStoredEvents();
      expect(stored).toHaveLength(1);
      const event = stored[0];
      expect(event).toBeDefined();
      expect(event?.schemaVersion).toBe(1);
      expect(event?.cost.pricingSource).toBe('calculated');
      expect(event?.cost.calculatedUsd).toBeGreaterThan(0);
      expect(event?.cost.billedUsd).toBe(event?.cost.calculatedUsd);
      expect(event?.cost.providerReportedUsd).toBeNull();
    });

    it('rejects events missing source.environment', async () => {
      const validEvent = createTestEventInput({ eventId: 'evt_missing_env' });
      const { environment: _omitted, ...sourceWithoutEnv } = validEvent.source;
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          schemaVersion: 2,
          events: [{ ...validEvent, source: sourceWithoutEnv }],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: {
          code: string;
          message: string;
          details?: { errors?: { path: string; message: string }[] };
        };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      const errors = body.error.details?.errors ?? [];
      expect(
        errors.some((e) => e.path.includes('source/environment') || e.path.includes('environment') || e.path.endsWith('source'))
      ).toBe(true);
      expect(eventRepo.getStoredEvents()).toHaveLength(0);
    });

    it('rejects events with invalid source.environment enum value', async () => {
      const validEvent = createTestEventInput({ eventId: 'evt_bad_env' });
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          schemaVersion: 2,
          events: [{
            ...validEvent,
            source: { ...validEvent.source, environment: 'staging' },
          }],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; details?: { errors?: { path: string }[] } };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(eventRepo.getStoredEvents()).toHaveLength(0);
    });

    it('rejects events with unknown top-level field (additionalProperties: false)', async () => {
      const validEvent = createTestEventInput({ eventId: 'evt_bogus' });
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          schemaVersion: 2,
          events: [{ ...validEvent, bogus: 1 }],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(eventRepo.getStoredEvents()).toHaveLength(0);
    });

    it('rejects entire batch when any single event is malformed (full-batch rejection)', async () => {
      const validEvent1 = createTestEventInput({ eventId: 'evt_batch_1' });
      const validEvent3 = createTestEventInput({ eventId: 'evt_batch_3' });
      const malformedEvent = {
        ...validEvent1,
        eventId: 'evt_batch_2_bad',
        usage: { ...validEvent1.usage, inputTokens: -5 },
      };
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          schemaVersion: 2,
          events: [validEvent1, malformedEvent, validEvent3],
        },
      });

      expect(response.statusCode).toBe(400);
      // Full-batch rejection: zero events persisted even though events[0] and events[2] were valid
      expect(eventRepo.getStoredEvents()).toHaveLength(0);
    });
  });

});
