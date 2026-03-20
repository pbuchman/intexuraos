import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';

describe('server', () => {
  const ctx = setupTestContext();

  describe('GET /health', () => {
    it('returns health status', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBeDefined();
      expect(body.serviceName).toBe('hellscript-agent');
      expect(body.version).toBe('1.0.0');
    });
  });

  describe('GET /openapi.json', () => {
    it('returns OpenAPI spec', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.openapi).toBe('3.1.1');
      expect(body.info.title).toBe('hellscript-agent');
    });
  });

  describe('GET /docs', () => {
    it('returns Swagger UI', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/docs',
      });

      // Swagger UI redirects to /docs/static/index.html
      expect([200, 302]).toContain(response.statusCode);
    });
  });

  describe('CORS headers', () => {
    it('includes CORS headers in response', async () => {
      const token = await createToken({ sub: 'test-user' });
      const response = await ctx.app.inject({
        method: 'OPTIONS',
        url: '/hellscript/buffers',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'GET',
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });
});
