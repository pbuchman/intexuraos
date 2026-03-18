import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ok } from '@intexuraos/common-core';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import type { ServiceContainer } from '../services.js';
import type { CronSchedule, CronExecution } from '../domain/types.js';

function createFakeServices(): ServiceContainer {
  return {
    logger: {
      info: () => { /* noop */ },
      warn: () => { /* noop */ },
      error: () => { /* noop */ },
      debug: () => { /* noop */ },
      child: () => createFakeServices().logger,
    } as never,
    scheduleRepo: {
      create: vi.fn(async () => ok({} as CronSchedule)),
      findById: vi.fn(async () => ok(null)),
      findByUserId: vi.fn(async () =>
        ok({ schedules: [], nextCursor: null, count: 0 }),
      ),
      findDueSchedules: vi.fn(async () => ok([])),
      update: vi.fn(async () => ok({} as CronSchedule)),
    },
    executionRepo: {
      create: vi.fn(async () => ok({} as CronExecution)),
      findById: vi.fn(async () => ok(null)),
      findByUserId: vi.fn(async () =>
        ok({ executions: [], nextCursor: null, count: 0 }),
      ),
      findByScheduleId: vi.fn(async () =>
        ok({ executions: [], nextCursor: null, count: 0 }),
      ),
      findRunningByScheduleId: vi.fn(async () => ok(null)),
      update: vi.fn(async () => ok({} as CronExecution)),
    },
    toolRegistry: {
      getToolsForService: vi.fn(async () => []),
      getToolsForServices: vi.fn(async () => []),
      listServiceTools: vi.fn(async () => []),
      refreshAll: vi.fn(async () => { /* noop */ }),
    },
    toolCallingClient: { run: vi.fn() } as never,
    geminiClient: {
      research: vi.fn(),
      generate: vi.fn(),
    } as never,
    internalAuthToken: 'test-token',
  };
}

describe('Server', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    setServices(createFakeServices());
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('GET /health', () => {
    it('returns 200 with health response structure', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      expect(['ok', 'degraded', 'down']).toContain(body.status);
      expect(body.serviceName).toBe('cron-agent');
      expect(body.version).toBe('1.0.0');

      expect(typeof body.timestamp).toBe('string');
      expect(Array.isArray(body.checks)).toBe(true);
      expect(body.checks.length).toBeGreaterThanOrEqual(1);

      const durationHeader = response.headers['x-health-duration-ms'];
      expect(durationHeader).toBeDefined();
      expect(typeof durationHeader).toBe('string');
    });
  });

  describe('GET /openapi.json', () => {
    it('returns OpenAPI spec', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const contentType = response.headers['content-type'];
      expect(contentType).toContain('application/json');

      const body = JSON.parse(response.body);
      expect(body.openapi).toMatch(/^3\.1/);
      expect(body.info.title).toBe('cron-agent');
      expect(body.info.version).toBe('1.0.0');
    });
  });

  describe('GET /docs', () => {
    it('returns Swagger UI', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs',
      });
      expect(response.statusCode).not.toBe(404);
      expect([200, 302]).toContain(response.statusCode);
    });
  });

  describe('CORS', () => {
    it('CORS headers are present on responses', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'GET',
        },
      });
      expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
    });
  });
});
