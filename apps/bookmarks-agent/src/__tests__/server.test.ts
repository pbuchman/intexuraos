import { describe, it, expect } from 'vitest';
import { setupTestContext } from './testUtils.js';

describe('Server', () => {
  const ctx = setupTestContext();

  describe('buildServer', () => {
    it('buildServer returns a Fastify instance with expected routes', async () => {
      // Verify the app is defined and has the inject method
      expect(ctx.app).toBeDefined();
      expect(typeof ctx.app.inject).toBe('function');

      // Verify key routes exist by checking they don't return 404
      const healthResponse = await ctx.app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(healthResponse.statusCode).not.toBe(404);

      const openapiResponse = await ctx.app.inject({
        method: 'GET',
        url: '/openapi.json',
      });
      expect(openapiResponse.statusCode).not.toBe(404);

      // Check that bookmark routes are registered (requires auth, so just check not 404)
      const bookmarksResponse = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks',
      });
      // Should not be 404 (route exists) - will be 401 due to auth
      expect(bookmarksResponse.statusCode).not.toBe(404);

      // Check internal routes
      const internalResponse = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks',
      });
      // Should not be 404 (route exists) - will be 401 due to missing auth
      expect(internalResponse.statusCode).not.toBe(404);

      // Check pubsub enrich route
      const pubsubEnrichResponse = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/pubsub/enrich',
      });
      // Should not be 404 (route exists) - will be 401 due to missing auth
      expect(pubsubEnrichResponse.statusCode).not.toBe(404);

      // Check pubsub summarize route
      const pubsubSummarizeResponse = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/pubsub/summarize',
      });
      // Should not be 404 (route exists) - will be 401 due to missing auth
      expect(pubsubSummarizeResponse.statusCode).not.toBe(404);
    });
  });

  describe('GET /health', () => {
    it('returns 200 with health response structure', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      // Verify health response structure
      expect(['ok', 'degraded', 'down']).toContain(body.status);
      expect(body.serviceName).toBe('bookmarks-agent');
      expect(body.version).toBe('0.0.4');

      // Verify timestamp is a valid ISO date string
      expect(typeof body.timestamp).toBe('string');
      const timestampDate = new Date(body.timestamp);
      expect(timestampDate.toISOString()).toBe(body.timestamp);

      // Verify checks is an array with at least 1 element
      expect(Array.isArray(body.checks)).toBe(true);
      expect(body.checks.length).toBeGreaterThanOrEqual(1);

      // Verify x-health-duration-ms header exists and is numeric
      const durationHeader = response.headers['x-health-duration-ms'];
      expect(durationHeader).toBeDefined();
      expect(typeof durationHeader).toBe('string');
      expect(Number.isNaN(Number(durationHeader))).toBe(false);
    });

    it('returns checks array with secrets check', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      // Verify checks array contains a secrets check
      const secretsCheck = body.checks.find((check: { name: string }) => check.name === 'secrets');
      expect(secretsCheck).toBeDefined();
      expect(secretsCheck.status).toBe('ok');

      // Verify checks array contains a firestore check
      const firestoreCheck = body.checks.find((check: { name: string }) => check.name === 'firestore');
      expect(firestoreCheck).toBeDefined();
      expect(['ok', 'degraded', 'down']).toContain(firestoreCheck.status);
    });
  });

  describe('CORS', () => {
    it('CORS headers are present on responses', async () => {
      const response = await ctx.app.inject({
        method: 'OPTIONS',
        url: '/bookmarks',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'GET',
        },
      });

      // Verify CORS headers are present and reflect the origin
      expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
    });
  });

  describe('GET /openapi.json', () => {
    it('returns OpenAPI spec', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);

      // Verify content-type includes application/json
      const contentType = response.headers['content-type'];
      expect(contentType).toContain('application/json');

      const body = JSON.parse(response.body);

      // Verify OpenAPI spec structure
      expect(body.openapi).toMatch(/^3\.1/);
      expect(body.info.title).toBe('bookmarks-agent');
      expect(body.info.version).toBe('0.0.4');
    });
  });

  describe('GET /docs', () => {
    it('returns Swagger UI', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/docs',
      });

      // Should not be 404 (should be 200 or 302 redirect to /docs/)
      expect(response.statusCode).not.toBe(404);
      // Should be 200 or 302
      expect([200, 302]).toContain(response.statusCode);
    });
  });
});
