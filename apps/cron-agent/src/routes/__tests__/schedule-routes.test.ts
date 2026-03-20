import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ok, err } from '@intexuraos/common-core';
import { buildServer } from '../../server.js';
import { setServices, resetServices } from '../../services.js';
import type { ServiceContainer } from '../../services.js';
import type { CronSchedule, CronExecution } from '../../domain/types.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockImplementation(async (request, reply) => {
      const authHeader = request.headers.authorization as string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const payloadBase64 = token.split('.')[1];
          if (payloadBase64 !== undefined) {
            const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString()) as {
              sub?: string;
            };
            if (payload.sub !== undefined) {
              return { userId: payload.sub };
            }
          }
        } catch {
          /* Invalid token format */
        }
      }
      await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
      return null;
    }),
  };
});

function makeTestToken(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ sub: userId })).toString('base64');
  return `${header}.${payload}.sig`;
}

const TEST_USER_ID = 'user-test-1';
const AUTH_HEADER = `Bearer ${makeTestToken(TEST_USER_ID)}`;

const testSchedule: CronSchedule = {
  id: 'schedule-1',
  userId: TEST_USER_ID,
  name: 'Test Schedule',
  description: 'Every minute',
  cronExpression: '*/5 * * * *',
  timezone: 'UTC',
  action: { services: ['code-agent'], instruction: 'do something', preferredTools: [] },
  status: 'active',
  lastExecutedAt: null,
  nextExecutionAt: '2026-01-01T00:01:00.000Z',
  executionCount: 0,
  failureCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const testExecution: CronExecution = {
  id: 'exec-1',
  scheduleId: 'schedule-1',
  scheduleName: 'Test Schedule',
  userId: TEST_USER_ID,
  status: 'success',
  trigger: 'manual',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:05.000Z',
  durationMs: 5000,
  toolCalls: [],
  agentResponse: 'Done',
  tokenUsage: { inputTokens: 10, outputTokens: 5, totalCost: 0.01 },
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function createFakeServices(overrides: Partial<ServiceContainer> = {}): ServiceContainer {
  return {
    logger: {
      info: () => { /* noop */ },
      warn: () => { /* noop */ },
      error: () => { /* noop */ },
      debug: () => { /* noop */ },
      child: () => createFakeServices().logger,
    } as never,
    scheduleRepo: {
      create: vi.fn(async () => ok(testSchedule)),
      findById: vi.fn(async () => ok(testSchedule)),
      findByUserId: vi.fn(async () =>
        ok({ schedules: [testSchedule], nextCursor: null, count: 1 }),
      ),
      findDueSchedules: vi.fn(async () => ok([])),
      update: vi.fn(async (_id: string, updates: Partial<CronSchedule>) =>
        ok({ ...testSchedule, ...updates }),
      ),
      incrementCounters: vi.fn(async () => ok(undefined)),
    },
    executionRepo: {
      create: vi.fn(async () => ok(testExecution)),
      findById: vi.fn(async () => ok(testExecution)),
      findByUserId: vi.fn(async () =>
        ok({ executions: [testExecution], nextCursor: null, count: 1 }),
      ),
      findByScheduleId: vi.fn(async () =>
        ok({ executions: [testExecution], nextCursor: null, count: 1 }),
      ),
      findRunningByScheduleId: vi.fn(async () => ok(null)),
      update: vi.fn(async (_id: string, updates: Partial<CronExecution>) =>
        ok({ ...testExecution, ...updates }),
      ),
    },
    toolRegistry: {
      getToolsForService: vi.fn(async () => []),
      getToolsForServices: vi.fn(async () => []),
      listServiceTools: vi.fn(async () => [
        {
          key: 'code-agent',
          name: 'Code Agent',
          tools: [
            {
              name: 'code_agent__run_code',
              description: 'Run code',
              parameters: { type: 'object', properties: {} },
            },
          ],
        },
      ]),
      refreshAll: vi.fn(async () => { /* noop */ }),
    },
    toolCallingClient: {
      run: vi.fn(async () =>
        ok({
          text: 'Done',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.01 },
          toolCalls: [],
        }),
      ),
    } as never,
    geminiClient: {
      research: vi.fn(async () =>
        ok({
          content: '',
          sources: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        }),
      ),
      generate: vi.fn(async () =>
        ok({
          content: '{"cronExpression": "*/5 * * * *", "humanSummary": "Every 5 minutes"}',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        }),
      ),
    } as never,
    internalAuthToken: 'test-token',
    ...overrides,
  };
}

describe('Schedule Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
    setServices(createFakeServices());
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('GET /cron/services', () => {
    it('returns 200 with services list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/services',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          services: {
            key: string;
            name: string;
            tools: { name: string; description: string; parameters: Record<string, unknown> }[];
          }[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.services).toHaveLength(1);
      expect(body.data.services[0]?.key).toBe('code-agent');
      expect(body.data.services[0]?.tools[0]?.parameters).toEqual({
        type: 'object',
        properties: {},
      });
    });

    it('returns 401 when no auth header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/services',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /cron/schedules', () => {
    it('returns 200 with schedules list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { schedules: CronSchedule[]; nextCursor: string | null; count: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.schedules).toHaveLength(1);
      expect(body.data.count).toBe(1);
    });

    it('returns 401 when no auth header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules',
      });

      expect(response.statusCode).toBe(401);
    });

    it('passes status filter to manager', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules?status=active,paused',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
    });

    it('passes limit query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules?limit=5',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
    });

    it('passes cursor query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules?cursor=abc',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
    });

    it('caps limit at 100 when larger value is provided', async () => {
      const fakeRepo = {
        create: vi.fn(async () => ok(testSchedule)),
        findById: vi.fn(async () => ok(testSchedule)),
        findByUserId: vi.fn(async () =>
          ok({ schedules: [testSchedule], nextCursor: null, count: 1 }),
        ),
        findDueSchedules: vi.fn(async () => ok([])),
        update: vi.fn(async (_id: string, updates: Partial<CronSchedule>) =>
          ok({ ...testSchedule, ...updates }),
        ),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules?limit=500',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
      expect(fakeRepo.findByUserId).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('returns error when manager list fails', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(),
        findByUserId: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'DB error' })),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(500);
    });

    it('rejects invalid limit query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules?limit=abc',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /cron/schedules', () => {
    const validBody = {
      name: 'Test',
      description: 'Every minute',
      action: {
        services: ['code-agent'],
        instruction: 'do something',
        preferredTools: [],
      },
    };

    it('returns 201 on success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: CronSchedule };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('schedule-1');
    });

    it('returns 401 when no auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        payload: validBody,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when body missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: { name: 'Test' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when name is empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: { ...validBody, name: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when action services is empty array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: {
          ...validBody,
          action: { services: [], instruction: 'test', preferredTools: [] },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('defaults preferredTools to empty array when omitted from create', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: {
          name: 'No tools',
          description: 'Every minute',
          action: { services: ['code-agent'], instruction: 'do something' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: CronSchedule };
      expect(body.data.action.preferredTools).toEqual([]);
    });

    it('round-trips preferredTools on create', async () => {
      const fakeRepo = {
        ...createFakeServices().scheduleRepo,
        create: vi.fn(async (_userId: string, input: {
          name: string;
          description: string;
          action: CronSchedule['action'];
          timezone: string;
          cronExpression: string;
          nextExecutionAt: string | null;
        }) =>
          ok({
            ...testSchedule,
            action: input.action,
          })),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo as never }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: {
          ...validBody,
          action: {
            services: ['code-agent'],
            instruction: 'do something',
            preferredTools: ['code_agent__run_code'],
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: CronSchedule };
      expect(body.data.action.preferredTools).toEqual(['code_agent__run_code']);
    });

    it('passes timezone when provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: { ...validBody, timezone: 'America/New_York' },
      });

      expect(response.statusCode).toBe(201);
    });

    it('defaults timezone to UTC when not provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
    });

    it('returns error when manager create fails with VALIDATION_ERROR', async () => {
      const fakeToolRegistry = {
        getToolsForService: vi.fn(async () => []),
        getToolsForServices: vi.fn(async () => []),
        listServiceTools: vi.fn(async () => []),
        refreshAll: vi.fn(async () => { /* noop */ }),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ toolRegistry: fakeToolRegistry }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: validBody,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns error when parse fails', async () => {
      const fakeGeminiClient = {
        research: vi.fn(async () => ok({ content: '', sources: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })),
        generate: vi.fn(async () => ok({ content: 'not valid json', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })),
      } as never;

      await app.close();
      resetServices();
      setServices(createFakeServices({ geminiClient: fakeGeminiClient }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules',
        headers: { authorization: AUTH_HEADER },
        payload: validBody,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /cron/schedules/:id', () => {
    it('returns 200 with schedule', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: CronSchedule };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('schedule-1');
    });

    it('returns 401 when no auth header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules/schedule-1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when schedule not found', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(null)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules/nonexistent',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when schedule belongs to different user', async () => {
      const otherUserSchedule = { ...testSchedule, userId: 'other-user' };
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(otherUserSchedule)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 500 when repo fails', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'DB down' })),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('PATCH /cron/schedules/:id', () => {
    it('returns 200 on success', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: CronSchedule };
      expect(body.success).toBe(true);
    });

    it('returns 401 when no auth header', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when status value is invalid', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { status: 'invalid_status' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when schedule not found', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(null)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/nonexistent',
        headers: { authorization: AUTH_HEADER },
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when schedule belongs to different user', async () => {
      const otherUserSchedule = { ...testSchedule, userId: 'other-user' };
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(otherUserSchedule)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('accepts update with description field', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { description: 'Every 5 minutes' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts update with action field', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: {
          action: {
            services: ['code-agent'],
            instruction: 'new task',
            preferredTools: ['code_agent__run_code'],
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('defaults preferredTools to empty array when omitted from update action', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: {
          action: { services: ['code-agent'], instruction: 'new task' },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts update with timezone field', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { timezone: 'America/New_York' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts update with status paused', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { status: 'paused' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts update with status active', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { status: 'active' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts update with status deleted', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { status: 'deleted' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 400 when action has unknown service key', async () => {
      const fakeToolRegistry = {
        getToolsForService: vi.fn(async () => []),
        getToolsForServices: vi.fn(async () => []),
        listServiceTools: vi.fn(async () => [
          { key: 'code-agent', name: 'Code Agent', tools: [] },
        ]),
        refreshAll: vi.fn(async () => { /* noop */ }),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ toolRegistry: fakeToolRegistry }));
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: {
          action: {
            services: ['nonexistent-service'],
            instruction: 'test',
            preferredTools: [],
          },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when repo update fails', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(testSchedule)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'DB error' })),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 400 when name is empty string', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
        payload: { name: '' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /cron/schedules/:id', () => {
    it('returns 200 on success', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('returns 401 when no auth header', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/cron/schedules/schedule-1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when schedule not found', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(null)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/cron/schedules/nonexistent',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when schedule belongs to different user', async () => {
      const otherUserSchedule = { ...testSchedule, userId: 'other-user' };
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(otherUserSchedule)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 500 when repo findById fails', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'DB error' })),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when repo update fails during delete', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(testSchedule)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'DB error' })),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/cron/schedules/schedule-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /cron/schedules/:id/trigger', () => {
    it('returns 200 on success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules/schedule-1/trigger',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: CronExecution };
      expect(body.success).toBe(true);
    });

    it('returns 401 when no auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules/schedule-1/trigger',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when schedule not found', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(null)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules/nonexistent/trigger',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when schedule belongs to different user', async () => {
      const otherUserSchedule = { ...testSchedule, userId: 'other-user' };
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(otherUserSchedule)),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules/schedule-1/trigger',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 500 when repo findById fails', async () => {
      const fakeRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'DB error' })),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules/schedule-1/trigger',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 409 when schedule is already running', async () => {
      const fakeExecutionRepo = {
        create: vi.fn(async () => ok(testExecution)),
        findById: vi.fn(async () => ok(testExecution)),
        findByUserId: vi.fn(),
        findByScheduleId: vi.fn(),
        findRunningByScheduleId: vi.fn(async () => ok(testExecution)),
        update: vi.fn(),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ executionRepo: fakeExecutionRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules/schedule-1/trigger',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 500 when execution fails', async () => {
      const fakeExecutionRepo = {
        create: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'Exec failed' })),
        findById: vi.fn(async () => ok(null)),
        findByUserId: vi.fn(),
        findByScheduleId: vi.fn(),
        findRunningByScheduleId: vi.fn(async () => ok(null)),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ executionRepo: fakeExecutionRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/cron/schedules/schedule-1/trigger',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
