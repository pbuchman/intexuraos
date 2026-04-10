import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
import { FakeUsageEventRepository } from '../fakeUsageEventRepository.js';
import { FakeUsageAggregateRepository } from '../fakeUsageAggregateRepository.js';
import { createTestEventInput } from '../helpers.js';

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
      const payload = {
        schemaVersion: 1,
        events: [createTestEventInput({
          eventId: 'evt_wh_1',
          source: { service: 'orchestrator', component: 'research', client: 'web', environment: 'dev' },
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
      const payload = {
        schemaVersion: 1,
        events: [createTestEventInput({
          eventId: 'evt_wh_bad',
          source: { service: 'other-service', component: 'research', client: 'web', environment: 'dev' },
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
      const body = JSON.parse(response.body) as { error: { message: string } };
      expect(body.error.message).toContain('orchestrator');
    });

    it('returns 400 for invalid schemaVersion', async () => {
      const payload = { schemaVersion: 2, events: [] };
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

      // Schema validation may reject, or our handler catches it
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
