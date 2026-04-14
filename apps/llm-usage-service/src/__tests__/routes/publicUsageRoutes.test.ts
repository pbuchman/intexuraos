import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { FastifyInstance } from 'fastify';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
import { FakeUsageEventRepository } from '../fakeUsageEventRepository.js';
import { FakeUsageAggregateRepository } from '../fakeUsageAggregateRepository.js';
import { FakePricingRepository } from '../fakePricingRepository.js';
import { FakePricingCache } from '../fakePricingCache.js';
import { createTestEvent } from '../helpers.js';
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from '../../domain/models/usageEvent.js';
import type { DailyUsageAggregate } from '../../domain/models/dailyAggregate.js';

// Mock common-http to control authentication
vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockImplementation(async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (authHeader === 'Bearer valid-token') {
        return { userId: 'user-123' };
      }
      await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
      return null;
    }),
  };
});

function createTestAggregate(overrides?: Partial<DailyUsageAggregate>): DailyUsageAggregate {
  return {
    aggregateId: 'test-agg-id',
    date: '2026-04-10',
    ownerType: 'user',
    ownerId: 'user_123',
    sourceService: 'orchestrator',
    sourceComponent: 'research',
    sourceClient: 'web',
    sourceEnvironment: 'dev',
    provider: LlmProviders.Anthropic,
    model: 'claude-sonnet-4-20250514',
    operation: 'generate',
    success: true,
    calls: 10,
    costUsd: 0.05,
    inputTokens: 1000,
    outputTokens: 2000,
    totalTokens: 3000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    thinkingTokens: 0,
    webSearchCalls: 0,
    imageCount: 0,
    firstOccurredAt: '2026-04-10T08:00:00.000Z',
    lastOccurredAt: '2026-04-10T20:00:00.000Z',
    updatedAt: '2026-04-10T20:00:01.000Z',
    ...overrides,
  };
}

describe('publicUsageRoutes', () => {
  let app: FastifyInstance;
  let eventRepo: FakeUsageEventRepository;
  let aggregateRepo: FakeUsageAggregateRepository;

  beforeAll(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
    const { buildServer } = await import('../../server.js');
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

  describe('POST /llm-usage/events/list', () => {
    it('returns 200 with paginated events when filters match', async () => {
      const event = createTestEvent({
        eventId: 'evt_match_1',
        occurredAt: '2026-04-10T12:00:00.000Z',
      });
      await eventRepo.createEvent(event);

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: { eventId: string }[]; totalMatched: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.events).toHaveLength(1);
      expect(body.data.events[0]?.eventId).toBe('evt_match_1');
      expect(body.data.totalMatched).toBe(1);
    });

    it('returns 200 with empty events array when none match', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: unknown[]; totalMatched: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.events).toHaveLength(0);
      expect(body.data.totalMatched).toBe(0);
    });

    it('returns 200 with nextCursor when more results exist', async () => {
      // Create more events than default limit
      for (let i = 0; i < DEFAULT_LIST_LIMIT + 5; i++) {
        const event = createTestEvent({
          eventId: `evt_page_${String(i).padStart(4, '0')}`,
          occurredAt: `2026-04-10T${String(12 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
        });
        await eventRepo.createEvent(event);
      }

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: unknown[]; nextCursor?: string; totalMatched: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.events).toHaveLength(DEFAULT_LIST_LIMIT);
      expect(body.data.nextCursor).toBeDefined();
    });

    it('accepts and decodes cursor from previous page', async () => {
      // Create enough events for pagination
      for (let i = 0; i < 5; i++) {
        const event = createTestEvent({
          eventId: `evt_cursor_${String(i).padStart(4, '0')}`,
          occurredAt: `2026-04-10T12:${String(i).padStart(2, '0')}:00.000Z`,
        });
        await eventRepo.createEvent(event);
      }

      // First page
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          limit: 3,
        },
      });

      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body) as {
        success: boolean;
        data: { events: { eventId: string }[]; nextCursor?: string };
      };
      expect(firstBody.data.events).toHaveLength(3);
      expect(firstBody.data.nextCursor).toBeDefined();

      // Second page using cursor
      const secondResponse = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          limit: 3,
          cursor: firstBody.data.nextCursor,
        },
      });

      expect(secondResponse.statusCode).toBe(200);
      const secondBody = JSON.parse(secondResponse.body) as {
        success: boolean;
        data: { events: { eventId: string }[] };
      };
      expect(secondBody.data.events).toHaveLength(2);
    });

    it('filters by providers', async () => {
      const anthropicEvent = createTestEvent({
        eventId: 'evt_anthropic',
        occurredAt: '2026-04-10T12:00:00.000Z',
      });
      const openaiEvent = createTestEvent({
        eventId: 'evt_openai',
        occurredAt: '2026-04-10T12:00:00.000Z',
        request: {
          provider: LlmProviders.OpenAI,
          model: 'gpt-4o',
          operation: 'generate',
          success: true,
          durationMs: 1000,
        },
      });
      await eventRepo.createEvent(anthropicEvent);
      await eventRepo.createEvent(openaiEvent);

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          filters: { providers: [LlmProviders.Anthropic] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: { eventId: string }[] };
      };
      expect(body.data.events).toHaveLength(1);
      expect(body.data.events[0]?.eventId).toBe('evt_anthropic');
    });

    it('filters by components', async () => {
      const researchEvent = createTestEvent({
        eventId: 'evt_research',
        occurredAt: '2026-04-10T12:00:00.000Z',
        source: {
          service: 'orchestrator',
          component: 'research',
          client: 'web',
          environment: 'dev',
        },
      });
      const generateEvent = createTestEvent({
        eventId: 'evt_generate',
        occurredAt: '2026-04-10T12:00:00.000Z',
        source: {
          service: 'orchestrator',
          component: 'generate',
          client: 'web',
          environment: 'dev',
        },
      });
      await eventRepo.createEvent(researchEvent);
      await eventRepo.createEvent(generateEvent);

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          filters: { components: ['research'] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: { eventId: string }[] };
      };
      expect(body.data.events).toHaveLength(1);
      expect(body.data.events[0]?.eventId).toBe('evt_research');
    });

    it('filters by services', async () => {
      const orchEvent = createTestEvent({
        eventId: 'evt_orch',
        occurredAt: '2026-04-10T12:00:00.000Z',
        source: {
          service: 'orchestrator',
          component: 'research',
          client: 'web',
          environment: 'dev',
        },
      });
      const otherEvent = createTestEvent({
        eventId: 'evt_other',
        occurredAt: '2026-04-10T12:00:00.000Z',
        source: {
          service: 'other-service',
          component: 'research',
          client: 'web',
          environment: 'dev',
        },
      });
      await eventRepo.createEvent(orchEvent);
      await eventRepo.createEvent(otherEvent);

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          filters: { services: ['orchestrator'] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: { eventId: string }[] };
      };
      expect(body.data.events).toHaveLength(1);
      expect(body.data.events[0]?.eventId).toBe('evt_orch');
    });

    it('filters by models', async () => {
      const claudeEvent = createTestEvent({
        eventId: 'evt_claude',
        occurredAt: '2026-04-10T12:00:00.000Z',
      });
      const gptEvent = createTestEvent({
        eventId: 'evt_gpt',
        occurredAt: '2026-04-10T12:00:00.000Z',
        request: {
          provider: LlmProviders.OpenAI,
          model: 'gpt-4o',
          operation: 'generate',
          success: true,
          durationMs: 1000,
        },
      });
      await eventRepo.createEvent(claudeEvent);
      await eventRepo.createEvent(gptEvent);

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          filters: { models: ['claude-sonnet-4-20250514'] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: { eventId: string }[] };
      };
      expect(body.data.events).toHaveLength(1);
      expect(body.data.events[0]?.eventId).toBe('evt_claude');
    });

    it('filters by ownerIds', async () => {
      const user1Event = createTestEvent({
        eventId: 'evt_user1',
        occurredAt: '2026-04-10T12:00:00.000Z',
        owner: { type: 'user', id: 'user_1' },
      });
      const user2Event = createTestEvent({
        eventId: 'evt_user2',
        occurredAt: '2026-04-10T12:00:00.000Z',
        owner: { type: 'user', id: 'user_2' },
      });
      await eventRepo.createEvent(user1Event);
      await eventRepo.createEvent(user2Event);

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          filters: { ownerIds: ['user_1'] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: { eventId: string }[] };
      };
      expect(body.data.events).toHaveLength(1);
      expect(body.data.events[0]?.eventId).toBe('evt_user1');
    });

    it('respects sortBy.field=occurredAt direction=desc (default)', async () => {
      const earlyEvent = createTestEvent({
        eventId: 'evt_early',
        occurredAt: '2026-04-10T08:00:00.000Z',
      });
      const lateEvent = createTestEvent({
        eventId: 'evt_late',
        occurredAt: '2026-04-10T20:00:00.000Z',
      });
      await eventRepo.createEvent(earlyEvent);
      await eventRepo.createEvent(lateEvent);

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          sortBy: { field: 'occurredAt', direction: 'desc' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: { eventId: string }[] };
      };
      // Sort is occurredAt desc, so late event comes first
      expect(body.data.events[0]?.eventId).toBe('evt_late');
      expect(body.data.events[1]?.eventId).toBe('evt_early');
    });

    it('clamps limit to MAX_LIST_LIMIT', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          limit: MAX_LIST_LIMIT + 100,
        },
      });

      // The schema enforces maximum: 200 so Fastify will reject this at validation
      expect(response.statusCode).toBe(400);
    });

    it('uses DEFAULT_LIST_LIMIT when not supplied', async () => {
      // Create exactly DEFAULT_LIST_LIMIT + 1 events
      for (let i = 0; i < DEFAULT_LIST_LIMIT + 1; i++) {
        const event = createTestEvent({
          eventId: `evt_default_${String(i).padStart(4, '0')}`,
          occurredAt: `2026-04-10T${String(12 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
        });
        await eventRepo.createEvent(event);
      }

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { events: unknown[]; nextCursor?: string };
      };
      expect(body.data.events).toHaveLength(DEFAULT_LIST_LIMIT);
      expect(body.data.nextCursor).toBeDefined();
    });

    it('returns 400 for invalid sortBy.field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          sortBy: { field: 'invalid_field', direction: 'asc' },
        },
      });

      // Schema has enum validation so Fastify returns 400
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for malformed cursor', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          cursor: 'not-a-valid-cursor!!!',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.message).toContain('cursor');
    });

    it('returns 400 when timeRange.from > timeRange.to', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-11T00:00:00Z',
            to: '2026-04-10T00:00:00Z',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.message).toContain('timeRange');
    });

    it('returns 401 for missing bearer token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/events/list',
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /llm-usage/events/:eventId', () => {
    it('returns 200 with full event when found', async () => {
      const event = createTestEvent({ eventId: 'evt_found' });
      await eventRepo.createEvent(event);

      const response = await app.inject({
        method: 'GET',
        url: '/llm-usage/events/evt_found',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { event: { eventId: string } };
      };
      expect(body.success).toBe(true);
      expect(body.data.event.eventId).toBe('evt_found');
    });

    it('returns 404 when not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/llm-usage/events/evt_nonexistent',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 for missing bearer token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/llm-usage/events/evt_test',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 500 when repository fails', async () => {
      eventRepo.setFailure({ code: 'DB_ERROR', message: 'connection lost' });

      const response = await app.inject({
        method: 'GET',
        url: '/llm-usage/events/evt_test',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /llm-usage/query', () => {
    it('returns 200 with aggregate rows', async () => {
      aggregateRepo.addAggregate(createTestAggregate());

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/query',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
          groupBy: ['request.provider'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { rows: unknown[]; totals: { calls: number } };
      };
      expect(body.success).toBe(true);
      expect(body.data.rows).toHaveLength(1);
      expect(body.data.totals.calls).toBe(10);
    });

    it('returns 200 with no optional fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/query',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { rows: unknown[]; totals: { calls: number } };
      };
      expect(body.success).toBe(true);
      expect(body.data.rows).toHaveLength(0);
    });

    it('returns 200 with all optional fields', async () => {
      aggregateRepo.addAggregate(createTestAggregate());

      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/query',
        headers: { authorization: 'Bearer valid-token' },
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
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { rows: unknown[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.rows).toHaveLength(1);
    });

    it('returns 400 for invalid groupBy', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/query',
        headers: { authorization: 'Bearer valid-token' },
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

    it('returns 401 for missing bearer token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/llm-usage/query',
        payload: {
          timeRange: {
            from: '2026-04-10T00:00:00Z',
            to: '2026-04-10T23:59:59Z',
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
