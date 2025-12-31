/**
 * Tests for system endpoints:
 * - GET /health
 * - GET /openapi.json
 */
import { describe, expect, it, setupTestContext } from './testUtils.js';

describe('System Endpoints', () => {
  const ctx = setupTestContext();

  it('GET /health returns raw health response (not wrapped)', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      status: string;
      serviceName: string;
      checks: unknown[];
    };
    // Health is NOT wrapped in success/data envelope
    expect(body.status).toBeDefined();
    expect(body.serviceName).toBe('notion-service');
    expect(body.checks).toBeDefined();
    expect((body as { success?: boolean }).success).toBeUndefined();
  });

  it('GET /openapi.json returns OpenAPI spec', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      openapi: string;
      info: { title: string };
      components: { securitySchemes: unknown };
    };
    expect(body.openapi).toMatch(/^3\./);
    expect(body.info.title).toBe('NotionService');
    expect(body.components.securitySchemes).toBeDefined();
  });
});
