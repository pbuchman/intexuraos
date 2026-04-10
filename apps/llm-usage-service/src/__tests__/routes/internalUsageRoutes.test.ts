import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
import { FakeUsageEventRepository } from '../fakeUsageEventRepository.js';
import { FakeUsageAggregateRepository } from '../fakeUsageAggregateRepository.js';
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
          schemaVersion: 1,
          events: [createTestEventInput({ eventId: 'evt_test_1' })],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { accepted: number } };
      expect(body.success).toBe(true);
      expect(body.data.accepted).toBe(1);
    });

    it('returns 401 for missing auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/events',
        payload: {
          schemaVersion: 1,
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
          schemaVersion: 2,
          events: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /internal/usage/query', () => {
    it('returns 200 with query result', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/query',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { rows: unknown[]; totals: { calls: number } } };
      expect(body.success).toBe(true);
      expect(body.data.rows).toEqual([]);
    });

    it('returns 401 for missing auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/query',
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 200 with query result including optional fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/query',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          filters: { providers: [LlmProviders.Anthropic] },
          groupBy: ['request.provider'],
          sortBy: { field: 'calls', direction: 'desc' },
          limit: 10,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { rows: unknown[] } };
      expect(body.success).toBe(true);
    });

    it('returns 400 for invalid groupBy field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/usage/query',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          groupBy: ['invalid_field'],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
