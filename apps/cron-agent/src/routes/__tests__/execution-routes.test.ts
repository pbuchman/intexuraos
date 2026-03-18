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
  cronExpression: '* * * * *',
  timezone: 'UTC',
  action: { services: ['code-agent'], instruction: 'do something' },
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
        ok({ schedules: [testSchedule], nextCursor: null, total: 1 }),
      ),
      findDueSchedules: vi.fn(async () => ok([])),
      update: vi.fn(async (_id: string, updates: Partial<CronSchedule>) =>
        ok({ ...testSchedule, ...updates }),
      ),
    },
    executionRepo: {
      create: vi.fn(async () => ok(testExecution)),
      findById: vi.fn(async () => ok(testExecution)),
      findByUserId: vi.fn(async () =>
        ok({ executions: [testExecution], nextCursor: null, total: 1 }),
      ),
      findByScheduleId: vi.fn(async () =>
        ok({ executions: [testExecution], nextCursor: null, total: 1 }),
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
        { key: 'code-agent', name: 'Code Agent', tools: [] },
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
          content: '{"cronExpression": "* * * * *", "humanSummary": "Every minute"}',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        }),
      ),
    } as never,
    internalAuthToken: 'test-token',
    ...overrides,
  };
}

describe('Execution Routes', () => {
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

  describe('GET /cron/executions', () => {
    it('returns 200 with executions list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { executions: CronExecution[]; nextCursor: string | null; total: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.executions).toHaveLength(1);
      expect(body.data.total).toBe(1);
    });

    it('returns 401 when no auth header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions',
      });

      expect(response.statusCode).toBe(401);
    });

    it('passes scheduleId filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions?scheduleId=schedule-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
    });

    it('passes status filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions?status=success,failure',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
    });

    it('passes limit query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions?limit=5',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
    });

    it('passes cursor query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions?cursor=abc',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
    });

    it('caps limit at 100 when larger value is provided', async () => {
      const fakeExecutionRepo = {
        create: vi.fn(async () => ok(testExecution)),
        findById: vi.fn(async () => ok(testExecution)),
        findByUserId: vi.fn(async () =>
          ok({ executions: [testExecution], nextCursor: null, total: 1 }),
        ),
        findByScheduleId: vi.fn(async () =>
          ok({ executions: [testExecution], nextCursor: null, total: 1 }),
        ),
        findRunningByScheduleId: vi.fn(async () => ok(null)),
        update: vi.fn(async (_id: string, updates: Partial<CronExecution>) =>
          ok({ ...testExecution, ...updates }),
        ),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ executionRepo: fakeExecutionRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions?limit=500',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
      expect(fakeExecutionRepo.findByUserId).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('uses default limit of 20 when not provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
    });

    it('rejects invalid limit query param', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions?limit=abc',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when repo findByUserId fails', async () => {
      const fakeExecutionRepo = {
        create: vi.fn(),
        findById: vi.fn(),
        findByUserId: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'DB error' })),
        findByScheduleId: vi.fn(),
        findRunningByScheduleId: vi.fn(),
        update: vi.fn(),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ executionRepo: fakeExecutionRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(500);
    });

    it('combines scheduleId and status filters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions?scheduleId=schedule-1&status=success',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /cron/executions/:id', () => {
    it('returns 200 with execution', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions/exec-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: CronExecution };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('exec-1');
    });

    it('returns 401 when no auth header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions/exec-1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when execution not found', async () => {
      const fakeExecutionRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(null)),
        findByUserId: vi.fn(),
        findByScheduleId: vi.fn(),
        findRunningByScheduleId: vi.fn(),
        update: vi.fn(),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ executionRepo: fakeExecutionRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions/nonexistent',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when execution belongs to different user', async () => {
      const otherUserExecution = { ...testExecution, userId: 'other-user' };
      const fakeExecutionRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => ok(otherUserExecution)),
        findByUserId: vi.fn(),
        findByScheduleId: vi.fn(),
        findRunningByScheduleId: vi.fn(),
        update: vi.fn(),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ executionRepo: fakeExecutionRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions/exec-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 500 when repo findById fails', async () => {
      const fakeExecutionRepo = {
        create: vi.fn(),
        findById: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'DB error' })),
        findByUserId: vi.fn(),
        findByScheduleId: vi.fn(),
        findRunningByScheduleId: vi.fn(),
        update: vi.fn(),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ executionRepo: fakeExecutionRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/cron/executions/exec-1',
        headers: { authorization: AUTH_HEADER },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
