import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import type { Config } from '../config.js';

const config: Config = {
  port: 8080,
  host: '127.0.0.1',
  openApiSources: [
    {
      name: 'cron-agent',
      url: 'https://example.com/cron-agent/openapi.json',
    },
  ],
};

describe('api-docs-hub server', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer(config);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns health status with configured source count', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.serviceName).toBe('api-docs-hub');
    expect(body.version).toBe('0.0.5');
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'config',
          status: 'ok',
          details: expect.objectContaining({
            sourceCount: 1,
          }),
        }),
      ])
    );
    expect(response.headers['x-health-duration-ms']).toBeDefined();
  });

  it('serves the generated OpenAPI spec and docs UI', async () => {
    const openApiResponse = await app.inject({
      method: 'GET',
      url: '/docs/json',
    });

    expect(openApiResponse.statusCode).toBe(200);
    expect(openApiResponse.headers['content-type']).toContain('application/json');

    const openApiBody = JSON.parse(openApiResponse.body);
    expect(openApiBody.openapi).toMatch(/^3\.1/);
    expect(openApiBody.info.title).toBe('api-docs-hub');
    expect(openApiBody.info.version).toBe('0.0.5');

    const docsResponse = await app.inject({
      method: 'GET',
      url: '/docs',
    });

    expect(docsResponse.statusCode).not.toBe(404);
    expect([200, 302]).toContain(docsResponse.statusCode);
  });
});
