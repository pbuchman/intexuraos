/**
 * Tests for the shared Fastify bootstrap.
 *
 * Behavior under test mirrors the bespoke bootstrap in
 * `apps/user-service/src/server.ts`: `/health` + `/openapi.json` exist with
 * the expected payload shape, the `registerRoutes` callback is invoked with
 * the app, and additional health checks are merged into `/health`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createFastifyApp } from '../createFastifyApp.js';
import type { HealthCheck } from '../health.js';

const baseOpts = {
  serviceName: 'test-svc',
  serviceVersion: '1.2.3',
  openapiInfo: { title: 'test-svc', description: 'test', version: '1.2.3' },
  openapiServers: [{ url: 'http://localhost', description: 'Local' }],
  openapiTags: [{ name: 'system', description: 'System endpoints' }],
  requiredSecrets: [] as readonly string[],
};

describe('createFastifyApp', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('serves /health with serviceName, version, and ok status when no secrets are required', async () => {
    app = await createFastifyApp({
      ...baseOpts,
      registerRoutes: async (): Promise<void> => undefined,
    });

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      serviceName: 'test-svc',
      version: '1.2.3',
      status: 'ok',
    });
    expect(Array.isArray(body.checks)).toBe(true);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('reports down when required secrets are missing', async () => {
    app = await createFastifyApp({
      ...baseOpts,
      requiredSecrets: ['__NEVER_SET_VAR_FOR_TEST__'],
      registerRoutes: async (): Promise<void> => undefined,
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('down');
    const secretsCheck = body.checks.find((c: HealthCheck) => c.name === 'secrets');
    expect(secretsCheck).toMatchObject({ status: 'down' });
  });

  it('serves /openapi.json as JSON', async () => {
    app = await createFastifyApp({
      ...baseOpts,
      registerRoutes: async (): Promise<void> => undefined,
    });

    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = res.json();
    expect(body.openapi).toBe('3.1.1');
    expect(body.info.title).toBe('test-svc');
  });

  it('invokes registerRoutes with the app instance', async () => {
    let registered = false;
    app = await createFastifyApp({
      ...baseOpts,
      registerRoutes: async (a) => {
        registered = true;
        a.get('/custom', async () => ({ ok: true }));
      },
    });
    expect(registered).toBe(true);

    const res = await app.inject({ method: 'GET', url: '/custom' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('runs extraHealthChecks and includes their results in the response', async () => {
    let invoked = 0;
    const extra = (): HealthCheck => {
      invoked += 1;
      return { name: 'custom', status: 'ok', latencyMs: 0, details: null };
    };
    app = await createFastifyApp({
      ...baseOpts,
      extraHealthChecks: [extra],
      registerRoutes: async (): Promise<void> => undefined,
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(invoked).toBe(1);
    const body = res.json();
    const customCheck = body.checks.find((c: HealthCheck) => c.name === 'custom');
    expect(customCheck).toMatchObject({ status: 'ok' });
  });

  it('awaits async extraHealthChecks', async () => {
    const extra = async (): Promise<HealthCheck> =>
      Promise.resolve({ name: 'async-check', status: 'degraded', latencyMs: 7, details: null });
    app = await createFastifyApp({
      ...baseOpts,
      extraHealthChecks: [extra],
      registerRoutes: async (): Promise<void> => undefined,
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body.status).toBe('degraded');
  });

  it('honors additionalOpenapiSchemas', async () => {
    app = await createFastifyApp({
      ...baseOpts,
      additionalOpenapiSchemas: {
        Custom: { type: 'object', properties: { x: { type: 'string' } } },
      },
      registerRoutes: async (): Promise<void> => undefined,
    });
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const body = res.json();
    expect(body.components.schemas.Custom).toBeDefined();
  });
});
