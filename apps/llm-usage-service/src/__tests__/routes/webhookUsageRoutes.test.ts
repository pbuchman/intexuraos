import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LlmProviders } from '@intexuraos/llm-contract';
import { buildServer } from '../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
import { FakeUsageEventRepository } from '../fakeUsageEventRepository.js';
import { FakeUsageAggregateRepository } from '../fakeUsageAggregateRepository.js';
import { FakePricingRepository } from '../fakePricingRepository.js';
import { FakePricingCache } from '../fakePricingCache.js';
import { createTestEventInput, createTestEventInputV2 } from '../helpers.js';

const SECRET = 'test-webhook-secret';

function signPayload(body: unknown, timestamp?: number): { timestamp: string; signature: string } {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const message = `${String(ts)}.${JSON.stringify(body)}`;
  const sig = crypto.createHmac('sha256', SECRET).update(message).digest('hex');
  return { timestamp: String(ts), signature: sig };
}

describe('webhookUsageRoutes', () => {
  let app: FastifyInstance;
  let eventRepo: FakeUsageEventRepository;
  let aggregateRepo: FakeUsageAggregateRepository;

  beforeAll(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
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
      orchestratorSecret: SECRET,
    } satisfies ServiceContainer);
  });

  afterEach(() => {
    resetServices();
  });

  afterAll(async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    await app.close();
  });

  describe('POST /internal/webhooks/usage-events', () => {
    it('returns 200 for valid signed request with orchestrator events', async () => {
      // Factory default already produces an orchestrator event with workerLocation,
      // so no source override needed.
      const payload = {
        schemaVersion: 1,
        events: [createTestEventInput({ eventId: 'evt_wh_1' })],
      };
      const { timestamp, signature } = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/usage-events',
        headers: {
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { accepted: number } };
      expect(body.success).toBe(true);
      expect(body.data.accepted).toBe(1);
    });

    it('returns 401 for missing signature', async () => {
      const payload = { schemaVersion: 1, events: [] };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/usage-events',
        payload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 for invalid signature', async () => {
      const payload = { schemaVersion: 1, events: [] };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/usage-events',
        headers: {
          'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-request-signature': 'invalid-signature-value-that-is-definitely-wrong-and-long-enough',
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects events with non-orchestrator source.service', async () => {
      // workerLocation is included so the ONLY violation is the const: 'orchestrator' constraint
      const payload = {
        schemaVersion: 1,
        events: [createTestEventInput({
          eventId: 'evt_wh_bad',
          source: {
            service: 'other-service',
            component: 'research',
            client: 'web',
            environment: 'dev',
            workerLocation: 'home-dev',
          },
        })],
      };
      const { timestamp, signature } = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/usage-events',
        headers: {
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
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
      // Assertion on the envelope-shaped error path; 'source/service' indicates the const constraint fired
      const errors = body.error.details?.errors ?? [];
      expect(errors.some((e) => e.path.includes('source/service') || e.path.includes('service'))).toBe(true);
      expect(eventRepo.getStoredEvents()).toHaveLength(0);
    });

    it('rejects orchestrator webhook payload missing source.workerLocation', async () => {
      // orchestrator event but source override drops workerLocation
      const payload = {
        schemaVersion: 1,
        events: [createTestEventInput({
          eventId: 'evt_wh_no_loc',
          source: {
            service: 'orchestrator',
            component: 'research',
            client: 'web',
            environment: 'dev',
            // workerLocation intentionally omitted
          },
        })],
      };
      const { timestamp, signature } = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/usage-events',
        headers: {
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
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

    it('returns 400 for invalid schemaVersion', async () => {
      const payload = { schemaVersion: 3, events: [] };
      const { timestamp, signature } = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/usage-events',
        headers: {
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects mismatched envelope — v1 schemaVersion with v2 events', async () => {
      const v2Event = createTestEventInputV2({ eventId: 'evt_wh_mismatch_1' });
      const payload = {
        schemaVersion: 1,
        events: [v2Event],
      };
      const { timestamp, signature } = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/usage-events',
        headers: {
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(eventRepo.getStoredEvents()).toHaveLength(0);
    });

    it('rejects mismatched envelope — v2 schemaVersion with v1 events', async () => {
      const v1Event = createTestEventInput({ eventId: 'evt_wh_mismatch_2' });
      const payload = {
        schemaVersion: 2,
        events: [v1Event],
      };
      const { timestamp, signature } = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/usage-events',
        headers: {
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(eventRepo.getStoredEvents()).toHaveLength(0);
    });

    it('accepts v2 orchestrator events and stores enriched cost in Firestore', async () => {
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
        orchestratorSecret: SECRET,
      } satisfies ServiceContainer);

      const payload = {
        schemaVersion: 2,
        events: [createTestEventInputV2({ eventId: 'evt_wh_v2_1' })],
      };
      const { timestamp, signature } = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/usage-events',
        headers: {
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
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
  });
});
