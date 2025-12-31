/**
 * Tests for system endpoints:
 * - GET /health
 * - GET /docs
 * - GET /openapi.json
 */
import { describe, expect, it, setupTestContext } from './testUtils.js';

describe('System Endpoints', () => {
  const ctx = setupTestContext();

  describe('GET /health', () => {
    it('returns health status', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        status: string;
        serviceName: string;
        version: string;
        checks: unknown[];
      };
      expect(body.status).toBeDefined();
      expect(body.serviceName).toBe('whatsapp-service');
      expect(body.checks).toBeDefined();
    });
  });

  describe('GET /docs', () => {
    it('returns Swagger UI', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/docs',
      });

      expect([200, 302]).toContain(response.statusCode);
    });
  });

  describe('GET /openapi.json', () => {
    it('returns OpenAPI specification', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        openapi: string;
        info: { title: string };
      };
      expect(body.openapi).toMatch(/^3\./);
      expect(body.info.title).toBe('whatsapp-service');
    });
  });
});
