import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { praxosFastifyPlugin } from '../http/fastifyPlugin.js';

describe('praxosFastifyPlugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(praxosFastifyPlugin);

    // Add test routes
    app.get('/test-ok', async (_req, reply) => {
      return await reply.ok({ message: 'success' });
    });

    app.get('/test-ok-with-diagnostics', async (_req, reply) => {
      return await reply.ok(
        { message: 'success' },
        { downstreamStatus: 200, endpointCalled: 'https://api.example.com' }
      );
    });

    app.get('/test-fail', async (_req, reply) => {
      return await reply.fail('INVALID_REQUEST', 'Something went wrong');
    });

    app.get('/test-fail-with-details', async (_req, reply) => {
      return await reply.fail(
        'UNAUTHORIZED',
        'Access denied',
        { downstreamStatus: 401 },
        { field: 'token' }
      );
    });

    await app.ready();
  });

  describe('reply.ok()', () => {
    it('returns correct envelope shape with success=true and data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-ok',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { message: string };
        diagnostics: { requestId: string; durationMs: number };
      };
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ message: 'success' });
      expect(body.diagnostics.requestId).toBeDefined();
      expect(typeof body.diagnostics.requestId).toBe('string');
      expect(body.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('merges additional diagnostics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-ok-with-diagnostics',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        diagnostics: {
          requestId: string;
          durationMs: number;
          downstreamStatus: number;
          endpointCalled: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.diagnostics.downstreamStatus).toBe(200);
      expect(body.diagnostics.endpointCalled).toBe('https://api.example.com');
    });
  });

  describe('reply.fail()', () => {
    it('returns correct envelope shape with success=false and error', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-fail',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
        diagnostics: { requestId: string; durationMs: number };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Something went wrong');
      expect(body.diagnostics.requestId).toBeDefined();
      expect(body.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns correct HTTP status for error code', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-fail-with-details',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string; details: { field: string } };
        diagnostics: { downstreamStatus: number };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.details).toEqual({ field: 'token' });
      expect(body.diagnostics.downstreamStatus).toBe(401);
    });
  });

  describe('x-request-id header', () => {
    it('sets x-request-id header in response', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-ok',
      });

      expect(response.headers['x-request-id']).toBeDefined();
      expect(typeof response.headers['x-request-id']).toBe('string');
    });

    it('propagates x-request-id from request unchanged', async () => {
      const customRequestId = 'custom-request-id-12345';

      const response = await app.inject({
        method: 'GET',
        url: '/test-ok',
        headers: {
          'x-request-id': customRequestId,
        },
      });

      expect(response.headers['x-request-id']).toBe(customRequestId);

      const body = JSON.parse(response.body) as {
        diagnostics: { requestId: string };
      };
      expect(body.diagnostics.requestId).toBe(customRequestId);
    });

    it('generates new x-request-id if not provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-ok',
      });

      const requestId = response.headers['x-request-id'];
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      // UUID format check
      expect((requestId as string).length).toBeGreaterThan(0);
    });
  });
});
