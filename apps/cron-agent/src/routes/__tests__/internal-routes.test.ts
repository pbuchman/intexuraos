import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ok, err } from '@intexuraos/common-core';
import { buildServer } from '../../server.js';
import { setServices, resetServices } from '../../services.js';
import type { ServiceContainer } from '../../services.js';
import type { CronSchedule, CronExecution } from '../../domain/types.js';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

const testSchedule: CronSchedule = {
  id: 'schedule-1',
  userId: 'user-1',
  name: 'Test Schedule',
  description: 'Every minute',
  cronExpression: '* * * * *',
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
  userId: 'user-1',
  status: 'success',
  trigger: 'scheduled',
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
    internalAuthToken: INTERNAL_AUTH_TOKEN,
    ...overrides,
  };
}

describe('Internal Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    setServices(createFakeServices());
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('POST /internal/cron/tick', () => {
    it('returns 200 with tick result when no due schedules', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { executed: number; skipped: number; errors: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.executed).toBe(0);
      expect(body.data.skipped).toBe(0);
      expect(body.data.errors).toBe(0);
    });

    it('returns 401 when Bearer token is not a valid JWT structure', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
        headers: { authorization: 'Bearer not-a-jwt' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 200 when authenticated via OIDC Bearer token (Cloud Scheduler)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
        headers: { authorization: 'Bearer header.payload.signature' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { executed: number; skipped: number; errors: number };
      };
      expect(body.success).toBe(true);
    });

    it('returns 401 when no internal auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when internal auth token is wrong', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
        headers: { 'x-internal-auth': 'wrong-token' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async () => {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
      await app.close();
      setServices(createFakeServices());
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
        headers: { 'x-internal-auth': 'any-token' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('processes due schedules and returns tick result', async () => {
      const fakeScheduleRepo = {
        create: vi.fn(async () => ok(testSchedule)),
        findById: vi.fn(async () => ok(testSchedule)),
        findByUserId: vi.fn(async () =>
          ok({ schedules: [testSchedule], nextCursor: null, count: 1 }),
        ),
        findDueSchedules: vi.fn(async () => ok([testSchedule])),
        update: vi.fn(async (_id: string, updates: Partial<CronSchedule>) =>
          ok({ ...testSchedule, ...updates }),
        ),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeScheduleRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { executed: number; skipped: number; errors: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.executed).toBe(1);
      expect(body.data.skipped).toBe(0);
      expect(body.data.errors).toBe(0);
    });

    it('skips schedules that are already running', async () => {
      const runningExecution = { ...testExecution, status: 'running' as const };
      const fakeScheduleRepo = {
        create: vi.fn(async () => ok(testSchedule)),
        findById: vi.fn(async () => ok(testSchedule)),
        findByUserId: vi.fn(async () =>
          ok({ schedules: [testSchedule], nextCursor: null, count: 1 }),
        ),
        findDueSchedules: vi.fn(async () => ok([testSchedule])),
        update: vi.fn(async (_id: string, updates: Partial<CronSchedule>) =>
          ok({ ...testSchedule, ...updates }),
        ),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };
      const fakeExecutionRepo = {
        create: vi.fn(async () => ok(testExecution)),
        findById: vi.fn(async () => ok(testExecution)),
        findByUserId: vi.fn(async () =>
          ok({ executions: [testExecution], nextCursor: null, count: 1 }),
        ),
        findByScheduleId: vi.fn(async () =>
          ok({ executions: [testExecution], nextCursor: null, count: 1 }),
        ),
        findRunningByScheduleId: vi.fn(async () => ok(runningExecution)),
        update: vi.fn(async (_id: string, updates: Partial<CronExecution>) =>
          ok({ ...testExecution, ...updates }),
        ),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({
        scheduleRepo: fakeScheduleRepo,
        executionRepo: fakeExecutionRepo,
      }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { executed: number; skipped: number; errors: number };
      };
      expect(body.data.skipped).toBe(1);
      expect(body.data.executed).toBe(0);
    });

    it('returns error count when findDueSchedules fails', async () => {
      const fakeScheduleRepo = {
        create: vi.fn(),
        findById: vi.fn(),
        findByUserId: vi.fn(),
        findDueSchedules: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'DB error' })),
        update: vi.fn(),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({ scheduleRepo: fakeScheduleRepo }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { executed: number; skipped: number; errors: number };
      };
      expect(body.data.errors).toBe(1);
      expect(body.data.executed).toBe(0);
    });

    it('counts errors when execution fails for a due schedule', async () => {
      const fakeScheduleRepo = {
        create: vi.fn(async () => ok(testSchedule)),
        findById: vi.fn(async () => ok(testSchedule)),
        findByUserId: vi.fn(async () =>
          ok({ schedules: [testSchedule], nextCursor: null, count: 1 }),
        ),
        findDueSchedules: vi.fn(async () => ok([testSchedule])),
        update: vi.fn(async (_id: string, updates: Partial<CronSchedule>) =>
          ok({ ...testSchedule, ...updates }),
        ),
        incrementCounters: vi.fn(async () => ok(undefined)),
      };
      const fakeExecutionRepo = {
        create: vi.fn(async () => err({ code: 'INTERNAL_ERROR' as const, message: 'Exec failed' })),
        findById: vi.fn(async () => ok(null)),
        findByUserId: vi.fn(),
        findByScheduleId: vi.fn(),
        findRunningByScheduleId: vi.fn(async () => ok(null)),
        update: vi.fn(),
      };

      await app.close();
      resetServices();
      setServices(createFakeServices({
        scheduleRepo: fakeScheduleRepo,
        executionRepo: fakeExecutionRepo,
      }));
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/cron/tick',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { executed: number; skipped: number; errors: number };
      };
      expect(body.data.errors).toBe(1);
      expect(body.data.executed).toBe(0);
    });
  });
});
