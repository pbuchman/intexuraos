import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { secretsHealthCheck } from '@intexuraos/http-server';
import { buildServer, MESSAGE_DIGEST_REQUIRED_SECRETS } from './server.js';

const originalEnv = { ...process.env };

describe('message-digest-service server', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      INTEXURAOS_INTERNAL_AUTH_TOKEN: 'synthetic-internal-token',
      INTEXURAOS_OPENROUTER_APP_API_KEY: 'synthetic-openrouter-key',
    };
  });

  afterEach(async () => {
    await app?.close();
    process.env = { ...originalEnv };
  });

  it('registers health, OpenAPI, and docs with the standalone service identity', async () => {
    app = await buildServer({
      healthChecks: [secretsHealthCheck([...MESSAGE_DIGEST_REQUIRED_SECRETS])],
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: 'ok',
      serviceName: 'message-digest-service',
      version: '3.8.0',
    });

    const openApi = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(openApi.statusCode).toBe(200);
    expect(openApi.json()).toMatchObject({
      openapi: expect.stringMatching(/^3\.1/u),
      info: { title: 'message-digest-service', version: '3.8.0' },
    });

    const docs = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 302]).toContain(docs.statusCode);
  });

  it('reports missing secret names safely without exposing configured values', async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
    app = await buildServer({
      healthChecks: [secretsHealthCheck([...MESSAGE_DIGEST_REQUIRED_SECRETS])],
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const body = health.json();
    expect(body.status).toBe('down');
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'secrets',
          status: 'down',
          details: {
            detail: 'missing: INTEXURAOS_INTERNAL_AUTH_TOKEN, INTEXURAOS_OPENROUTER_APP_API_KEY',
          },
        }),
      ])
    );
    expect(health.body).not.toContain('synthetic-internal-token');
    expect(health.body).not.toContain('synthetic-openrouter-key');
  });
});
